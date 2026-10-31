import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SubscriptionActivationService } from './subscription-activation.service';
import { EntitlementsService } from './entitlements.service';
import { ENTITLEMENTS_QUEUE } from './entitlements.constants';
import { EntitlementsProcessor } from './entitlements-sweep.processor';
import { EntitlementsScheduler } from './entitlements.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: ENTITLEMENTS_QUEUE })],
  providers: [
    SubscriptionActivationService,
    EntitlementsService,
    EntitlementsScheduler,
    EntitlementsProcessor,
  ],
  exports: [
    SubscriptionActivationService,
    EntitlementsService,
    EntitlementsScheduler,
  ],
})
export class SubscriptionsCoreModule {}
