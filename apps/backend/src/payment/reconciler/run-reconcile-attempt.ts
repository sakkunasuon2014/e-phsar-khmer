import type { Logger } from '@nestjs/common';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import type { DbClient } from '../../db/drizzle.provider';
import { DbClientTag } from '../../db/db.provider';
import type { OutboxService } from '../../outbox/outbox.service';
import type { PaymentGatewayRegistry } from '../providers/payment-gateway.registry';
import { PaymentGatewayRegistryTag } from '../providers/payment-gateway-registry.provider';
import { expirePaymentAttempt, reconcilePaymentAttempt } from '../use-cases';
import type { ReconcilePaymentAttemptOutcome } from '../use-cases';

export type ReconcileAttemptResult = ReconcilePaymentAttemptOutcome | 'error';

export interface ReconcileAttemptDeps {
  db: DbClient;
  registry: PaymentGatewayRegistry;
  outbox: OutboxService;
  logger: Logger;
}

/**
 * The Promise boundary around the Effect-based `reconcilePaymentAttempt` —
 * the same role `PaymentProcessor.run()` plays for BullMQ jobs. Kept apart
 * from `PaymentReconciler` so the service itself stays plain async code.
 *
 * Never throws: a typed failure or a defect is logged and returned as
 * `'error'`, because one bad attempt must not stop the rest of the sweep.
 */
export async function runReconcileAttempt(
  deps: ReconcileAttemptDeps,
  input: {
    paymentAttemptId: string;
    abandonPendingAfterMs: number;
    expiryGraceMs: number;
  },
): Promise<ReconcileAttemptResult> {
  const layer = Layer.mergeAll(
    DbClientTag.layer(deps.db),
    PaymentGatewayRegistryTag.layer(deps.registry),
  );

  const exit = await Effect.runPromiseExit(
    Effect.provide(reconcilePaymentAttempt(deps.outbox, input), layer),
  );

  if (Exit.isSuccess(exit)) {
    if (exit.value === 'succeeded') {
      deps.logger.log(`Settled payment attempt ${input.paymentAttemptId}`);
    }
    return exit.value;
  }

  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure)) {
    // A version conflict means the poll chain (or another instance) settled
    // it between our read and write — the intended loser of a race.
    if (failure.value._tag === 'PaymentTransactionConflictError') {
      return 'skipped';
    }
    deps.logger.warn(
      `Reconcile of attempt ${input.paymentAttemptId} failed: ${failure.value._tag}`,
    );
  } else {
    deps.logger.warn(
      `Reconcile of attempt ${input.paymentAttemptId} crashed: ${String(Cause.squash(exit.cause))}`,
    );
  }
  return 'error';
}

/** Promise boundary for `expirePaymentAttempt` (DB only, no provider call). */
export async function runExpireAttempt(
  deps: Pick<ReconcileAttemptDeps, 'db' | 'logger'>,
  paymentAttemptId: string,
): Promise<'skipped' | 'expired' | 'error'> {
  const exit = await Effect.runPromiseExit(
    Effect.provide(
      expirePaymentAttempt({ paymentAttemptId }),
      DbClientTag.layer(deps.db),
    ),
  );
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.findErrorOption(exit.cause);
  // A version conflict means the webhook settled it first — the intended winner.
  if (
    Option.isSome(failure) &&
    failure.value._tag === 'PaymentTransactionConflictError'
  ) {
    return 'skipped';
  }
  deps.logger.warn(
    `Expiring attempt ${paymentAttemptId} failed: ${Option.isSome(failure) ? failure.value._tag : String(Cause.squash(exit.cause))}`,
  );
  return 'error';
}
