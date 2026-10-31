import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import {
  LISTING_EXPIRY_QUEUE,
  LISTING_EXPIRY_SWEEP_EVERY_MS,
  LISTING_EXPIRY_SWEEP_JOB,
} from './listing-expiry.constants';
import { ListingExpiryService } from './listing-expiry.service';

/**
 * Registers the hourly expiry sweep as a BullMQ job scheduler. An upsert, so
 * every instance calling it on boot keeps exactly one schedule — the same
 * pattern as `ChatMaintenanceScheduler` and `EntitlementsScheduler`.
 */
@Injectable()
export class ListingExpiryScheduler implements OnModuleInit {
  private readonly logger = new Logger(ListingExpiryScheduler.name);

  constructor(
    @InjectQueue(LISTING_EXPIRY_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        LISTING_EXPIRY_SWEEP_JOB,
        { every: LISTING_EXPIRY_SWEEP_EVERY_MS },
        { name: LISTING_EXPIRY_SWEEP_JOB },
      );
    } catch (err) {
      // Housekeeping: never block boot on it. The next successful
      // registration restores the schedule.
      this.logger.warn(
        `Could not schedule ${LISTING_EXPIRY_SWEEP_JOB}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * The sweep tells owners their ad is about to lapse, and once that it has.
 * It never mutates the listing: expiry stays derived at read time.
 */
@Processor(LISTING_EXPIRY_QUEUE)
export class ListingExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(ListingExpiryProcessor.name);

  constructor(private readonly expiry: ListingExpiryService) {
    super();
  }

  async process(job: Job): Promise<{ expiring: number; expired: number }> {
    if (job.name !== LISTING_EXPIRY_SWEEP_JOB) {
      return { expiring: 0, expired: 0 };
    }
    const result = await this.expiry.sweep();
    if (result.expiring > 0 || result.expired > 0) {
      this.logger.log(
        `Expiry notices: ${result.expiring} expiring, ${result.expired} expired`,
      );
    }
    return result;
  }
}
