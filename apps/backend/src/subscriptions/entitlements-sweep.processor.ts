import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EntitlementsService } from './entitlements.service';
import {
  ENTITLEMENTS_QUEUE,
  LISTING_SWEEP_JOB,
} from './entitlements.constants';

/**
 * Nothing fires when a subscription's `expires_at` passes, so this is what
 * restricts an owner's over-limit ads from public browsing after a lapse.
 */
@Processor(ENTITLEMENTS_QUEUE)
export class EntitlementsProcessor extends WorkerHost {
  private readonly logger = new Logger(EntitlementsProcessor.name);

  constructor(private readonly entitlements: EntitlementsService) {
    super();
  }

  async process(job: Job): Promise<{ users: number }> {
    if (job.name !== LISTING_SWEEP_JOB) return { users: 0 };
    const users = await this.entitlements.reconcileAll();
    if (users > 0) this.logger.log(`Reconciled listings for ${users} user(s)`);
    return { users };
  }
}
