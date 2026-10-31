import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { OutboxEventRow } from '../../db/schema/outbox.schema';
import { OutboxRegistry } from '../../outbox/outbox-registry.service';
import type { HandlerOutcome, OutboxHandler } from '../../outbox/outbox.types';
import { NotificationsService } from '../../notifications/notifications.service';
import type { PaymentSettledEventPayload } from '../use-cases/payments/processing/enqueue-payment-settled-event.use-case';
import { PAYMENT_SETTLED_OUTBOX_EVENT_TYPE } from './payment-outbox-events';
import { SubscriptionActivationService } from '../../subscriptions/subscription-activation.service';

/**
 * Consumes `payment.succeeded` and notifies the payment's owner. Unlike the
 * other handlers in this folder, it does the work directly instead of
 * re-queueing to BullMQ — notifying has no gateway call worth isolating
 * behind a worker pool, so the outbox's own retry is durability enough.
 */
@Injectable()
export class PaymentSettledOutboxHandler
  implements OutboxHandler, OnModuleInit
{
  readonly eventType = PAYMENT_SETTLED_OUTBOX_EVENT_TYPE;

  private readonly logger = new Logger(PaymentSettledOutboxHandler.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly registry: OutboxRegistry,
    private readonly activation: SubscriptionActivationService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEventRow): Promise<HandlerOutcome> {
    const payload = event.payload as PaymentSettledEventPayload;

    try {
      if (payload.orderId) {
        const result = await this.activation.activatePaidPurchase({
          purchaseId: payload.orderId,
          paymentTransactionId: payload.paymentTransactionId,
          customerId: payload.customerId,
          amount: payload.amount,
          currency: payload.currency,
        });
        if (result.status === 'payment_link_pending') {
          return {
            status: 'retry',
            error: `Purchase ${payload.orderId} is not linked to its payment yet`,
          };
        }
        if (
          result.status === 'payment_mismatch' ||
          result.status === 'needs_refund' ||
          result.status === 'not_pending' ||
          result.status === 'not_found'
        ) {
          this.logger.warn(
            `Settled transaction ${payload.paymentTransactionId} could not activate subscription purchase ${payload.orderId} (${result.status}) — needs manual review`,
          );
        }
      }

      if (payload.customerId) {
        await this.notifications.notify({
          userId: payload.customerId,
          type: this.eventType,
          title: 'Payment successful',
          body: `Your payment of ${payload.amount} ${payload.currency} has been received.`,
          data: {
            paymentTransactionId: payload.paymentTransactionId,
            ledgerTransactionId: payload.ledgerTransactionId,
            amount: payload.amount,
            currency: payload.currency,
            occurredAt: payload.occurredAt,
          },
        });
      }
      return { status: 'published' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Could not notify customer for settled transaction ${payload.paymentTransactionId}: ${message}`,
      );
      return { status: 'retry', error: message };
    }
  }
}
