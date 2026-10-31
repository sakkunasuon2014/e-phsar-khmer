import { ConflictException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { UserSubscriptionsService } from './user-subscriptions.service';

function query(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'limit']) q[method] = jest.fn(() => q);
  q.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
  return q;
}

function makeService({
  updated = [],
  existing = [],
}: {
  updated?: unknown[];
  existing?: unknown[];
} = {}) {
  const returning = jest.fn().mockResolvedValue(updated);
  const where = jest.fn<{ returning: typeof returning }, [unknown?]>(() => ({
    returning,
  }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const select = jest.fn(() => query(existing));
  const reconcileListingsSafely = jest.fn().mockResolvedValue(undefined);
  const service = new UserSubscriptionsService(
    { update, select } as never,
    {} as never,
    { reconcileListingsSafely } as never,
  );
  return { service, update, select, set, where, reconcileListingsSafely };
}

describe('UserSubscriptionsService.revoke', () => {
  it('revokes a current row and reconciles the owner listings', async () => {
    const { service, set, where, reconcileListingsSafely } = makeService({
      updated: [{ userId: 'user-1' }],
    });

    await expect(service.revoke('subscription-1')).resolves.toEqual({
      id: 'subscription-1',
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ supersededReason: 'revoked' }),
    );
    expect(where).toHaveBeenCalledTimes(1);
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(where.mock.calls[0][0] as never);
    expect(query.sql).toContain('"superseded_at" is null');
    expect(reconcileListingsSafely).toHaveBeenCalledWith('user-1');
  });

  it('returns 409 for a subscription that is no longer current', async () => {
    const { service } = makeService({ existing: [{ id: 'subscription-1' }] });

    await expect(service.revoke('subscription-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('returns 404 for an unknown subscription id', async () => {
    const { service } = makeService();

    await expect(service.revoke('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
