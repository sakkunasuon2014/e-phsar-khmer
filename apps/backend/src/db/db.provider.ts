import { Context, Effect, Exit, Layer } from 'effect';
import type { DbExecutor } from './drizzle.provider';

export const DB_PROVIDER_ID = 'phsarkhmer/db/DbClient';

/**
 * Effect-side handle for the Drizzle executor. This wraps either the root
 * client (`DbClient`) or a live `db.transaction()` handle (`PgTransaction`),
 * so Effect use-cases can `yield* DbClientTag` regardless of whether they
 * run standalone or inside a database transaction.
 */
export class DbClientTag extends Context.Service<DbClientTag, DbExecutor>()(
  DB_PROVIDER_ID,
) {
  static readonly layer = (db: DbExecutor) => Layer.succeed(DbClientTag, db);
}

class RollbackException<E> extends Error {
  readonly _tag = 'RollbackException';
  constructor(readonly exit: Exit.Exit<unknown, E>) {
    super('RollbackException');
  }
}

/**
 * Runs an effect inside a database transaction (`db.transaction`).
 * - On success: commits the transaction and yields the effect's result.
 * - On typed failure or defect: rolls back the transaction and preserves
 *   the original failure or defect.
 * - On database driver error: fails with `onPersistenceError(cause)`.
 */
export const withTransaction = <A, E, E2>(
  db: DbExecutor,
  effect: Effect.Effect<A, E, DbClientTag>,
  onPersistenceError: (cause: unknown) => E2,
): Effect.Effect<A, E | E2> =>
  Effect.gen(function* () {
    const exit: Exit.Exit<A, E | E2> = yield* Effect.promise(() =>
      db
        .transaction(async (tx) => {
          const innerExit = await Effect.runPromiseExit(
            Effect.provide(effect, DbClientTag.layer(tx)),
          );
          if (Exit.isFailure(innerExit)) {
            throw new RollbackException(innerExit);
          }
          return innerExit as Exit.Exit<A, E | E2>;
        })
        .catch((cause) => {
          if (cause instanceof RollbackException) {
            return cause.exit as Exit.Exit<A, E>;
          }
          return Exit.fail(onPersistenceError(cause));
        }),
    );

    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    return yield* Effect.failCause(exit.cause);
  });

/**
 * Runs an effect inside a database transaction obtained from the ambient `DbClientTag`.
 */
export const runInTransaction = <A, E, E2>(
  effect: Effect.Effect<A, E, DbClientTag>,
  onPersistenceError: (cause: unknown) => E2,
): Effect.Effect<A, E | E2, DbClientTag> =>
  Effect.gen(function* () {
    const db = yield* DbClientTag;
    return yield* withTransaction(db, effect, onPersistenceError);
  });
