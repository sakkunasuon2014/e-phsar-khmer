import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsController } from './payment.controller';
import { AbaPaywayWebhookController } from './webhooks/aba-payway-webhook.controller';
import { PAYMENT_GATEWAY_PROVIDERS, PaymentGatewayRegistry } from './providers';
import { AbaPaywayProvider } from './providers/aba-payway/aba-payway.provider';
import { BakongProvider } from './providers/bakong/bakong.provider';
import { PAYMENT_QUEUE } from './payment.constants';
import { JOB_RETENTION } from '../common/queue/queue-defaults';
import { PaymentEffectRunner } from './payment-effect-runner.service';
import { PaymentAttemptOutboxHandler } from './outbox/payment-attempt-outbox-handler';
import { PaymentEventOutboxHandler } from './outbox/payment-event-outbox-handler';
import { PaymentPollOutboxHandler } from './outbox/payment-poll-outbox-handler';
import { PaymentSettledOutboxHandler } from './outbox/payment-settled-outbox-handler';
import { PaymentProcessor } from './processors/payment.processor';
import { PaymentReconciler } from './reconciler/payment-reconciler.service';
import { PaymentOnDemandReconciler } from './reconciler/payment-on-demand-reconciler.service';
import { OutboxModule } from '../outbox/outbox.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsCoreModule } from '../subscriptions/subscriptions-core.module';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: PAYMENT_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // Replaces (not merges with) the root BullModule defaultJobOptions,
        // so the retention has to be repeated here — this queue used to be the
        // one that filled Redis fastest (a poll job every few seconds per open
        // Bakong checkout, before the reconciler became the one poller).
        defaultJobOptions: {
          ...JOB_RETENTION,
          attempts: configService.get<number>('payment.jobAttempts') ?? 3,
          backoff: {
            type: 'exponential' as const,
            delay: configService.get<number>('payment.jobBackoffMs') ?? 5000,
          },
        },
      }),
    }),
    // Not @Global() — importing it is a real architectural choice (this
    // module now both produces outbox rows and publishes them to BullMQ).
    // See ../outbox/outbox.module.ts's own doc comment.
    OutboxModule,
    // For PaymentSettledOutboxHandler — telling the customer their payment
    // settled is a notification concern, not a payment-processing one.
    NotificationsModule,
    SubscriptionsCoreModule,
  ],
  controllers: [PaymentsController, AbaPaywayWebhookController],
  providers: [
    PaymentGatewayRegistry,
    AbaPaywayProvider,
    BakongProvider,
    {
      provide: PAYMENT_GATEWAY_PROVIDERS,
      inject: [AbaPaywayProvider, BakongProvider],
      useFactory: (abaPayway: AbaPaywayProvider, bakong: BakongProvider) => [
        abaPayway,
        bakong,
      ],
    },
    PaymentEffectRunner,
    // Publish the outbox event types this module produces to BullMQ — register
    // themselves with OutboxRegistry from onModuleInit. The poll handler is a
    // legacy drain for rows written before the poll chain was retired.
    PaymentAttemptOutboxHandler,
    PaymentEventOutboxHandler,
    PaymentPollOutboxHandler,
    // Consumes the BullMQ job kinds — the first @Processor in this repo.
    PaymentProcessor,
    // The one poller for a provider with no webhook, armed by payment.issued:
    // settles any unresolved attempt straight from Postgres, so a payment made
    // while the app was down still activates. See reconciler/payment-reconciler.service.ts.
    PaymentReconciler,
    // Lets a payer's own GET /payments/:id nudge a settle along (throttled).
    PaymentOnDemandReconciler,
    // Consumes the business-level payment.succeeded event — notifies the
    // customer directly, no BullMQ hop (see its own doc comment).
    PaymentSettledOutboxHandler,
  ],
  // BullModule re-exported so any future module (e.g. a subscription
  // checkout flow) can `imports: [PaymentModule]` and `@InjectQueue` the
  // same `payments` queue instead of re-registering it.
  // PaymentEffectRunner exported for SubscriptionsModule's checkout.
  exports: [PaymentGatewayRegistry, PaymentEffectRunner, BullModule],
})
export class PaymentModule {}
