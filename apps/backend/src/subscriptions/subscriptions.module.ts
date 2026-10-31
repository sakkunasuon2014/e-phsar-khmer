import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { SubscriptionsCoreModule } from './subscriptions-core.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [PaymentModule, SubscriptionsCoreModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
})
export class SubscriptionsModule {}
