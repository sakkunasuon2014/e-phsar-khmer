import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { OutboxEventRow } from '../../db/schema/outbox.schema';
import { OutboxRegistry } from '../../outbox/outbox-registry.service';
import type { HandlerOutcome, OutboxHandler } from '../../outbox/outbox.types';
import { PAYMENT_ATTEMPT_POLL_OUTBOX_EVENT_TYPE } from './payment-outbox-events';

/**
 * Legacy drain for `payment.attempt.poll_requested` rows.
 *
 * Nothing writes these any more: the self-rescheduling poll chain (outbox row
 * → BullMQ delayed job → Bakong call → next outbox row) is retired, and
 * `PaymentReconciler` is the one poller, reading open attempts straight from
 * Postgres. The handler stays registered only so rows written before the
 * switch finish cleanly — an unregistered event type is retried with backoff
 * and then marked `failed`, which would be noise for work that is already
 * covered. It deliberately does not enqueue anything: the attempt a row names
 * is still `pending` in the database, and the reconciler finds it there.
 *
 * Safe to delete, with `PAYMENT_ATTEMPT_POLL_OUTBOX_EVENT_TYPE` and the
 * `poll-attempt` branch in `PaymentProcessor`, once no such row can remain
 * (outbox retention is `OUTBOX_RETENTION_DAYS`).
 */
@Injectable()
export class PaymentPollOutboxHandler implements OutboxHandler, OnModuleInit {
  readonly eventType = PAYMENT_ATTEMPT_POLL_OUTBOX_EVENT_TYPE;

  private readonly logger = new Logger(PaymentPollOutboxHandler.name);

  constructor(private readonly registry: OutboxRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  handle(event: OutboxEventRow): Promise<HandlerOutcome> {
    this.logger.debug(
      `Draining legacy poll row ${event.id}; the reconciler polls from the database now`,
    );
    return Promise.resolve({ status: 'published' });
  }
}
