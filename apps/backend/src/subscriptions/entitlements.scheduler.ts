import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ENTITLEMENTS_QUEUE,
  LISTING_SWEEP_JOB,
} from './entitlements.constants';

const SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * Fixed ids: BullMQ ignores an `add` whose id already exists in any state.
 * They must not contain `:` - BullMQ rejects such custom ids.
 */
export const CONFIG_RECONCILE_JOB_ID = 'reconcile-on-config-change';
export const CONFIG_RECONCILE_NEXT_JOB_ID = `${CONFIG_RECONCILE_JOB_ID}-next`;

/**
 * Registers the recurring sweep as a BullMQ job scheduler (an upsert, so every
 * instance calling it on boot keeps exactly one schedule - same pattern as
 * `ChatMaintenanceScheduler`) and enqueues the one-off sweep that follows an
 * admin config edit.
 */
@Injectable()
export class EntitlementsScheduler implements OnModuleInit {
  private readonly logger = new Logger(EntitlementsScheduler.name);

  constructor(@InjectQueue(ENTITLEMENTS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        LISTING_SWEEP_JOB,
        { every: SWEEP_EVERY_MS },
        { name: LISTING_SWEEP_JOB },
      );
    } catch (err) {
      // Never block boot on housekeeping: the recurring sweep is a backstop.
      this.logger.warn(
        `Could not schedule ${LISTING_SWEEP_JOB}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Queues a reconciliation after an admin config edit. Never throws.
   *
   * A burst of edits collapses into one *waiting* job, because that job reads
   * the config only when it starts. A job that is already *running* may have
   * read the config before this edit, so while one is active the edit goes to
   * a second, `-next` slot that waits behind it - at most one running plus one
   * waiting, never an edit silently dropped until the 10-minute backstop.
   *
   * `removeOnFail` matters: a failed job kept under a fixed id would block
   * every later `add` with that id.
   */
  async enqueueConfigReconcile(): Promise<void> {
    try {
      const current = await this.queue.getJob(CONFIG_RECONCILE_JOB_ID);
      const running = current ? await current.isActive() : false;
      await this.queue.add(
        LISTING_SWEEP_JOB,
        {},
        {
          jobId: running
            ? CONFIG_RECONCILE_NEXT_JOB_ID
            : CONFIG_RECONCILE_JOB_ID,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      // The recurring sweep remains the backstop if Redis is unavailable.
      this.logger.warn(
        `Could not enqueue ${LISTING_SWEEP_JOB} after config change: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
