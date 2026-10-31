import { PgDialect } from 'drizzle-orm/pg-core';
import { userSubscriptions } from '../db/schema/subscriptions.schema';
import {
  activePaidSubscriptionExistsSql,
  hasActivePaidSubscription,
} from './verified-account.util';

function makeDb(rows: unknown[]) {
  const calls: { where?: unknown } = {};
  return {
    calls,
    select: jest.fn(() => ({
      from: () => ({
        where: (arg: unknown) => {
          calls.where = arg;
          return { limit: () => Promise.resolve(rows) };
        },
      }),
    })),
  };
}

describe('hasActivePaidSubscription', () => {
  it('is true when the user holds a current subscription row', async () => {
    const db = makeDb([{ id: 'sub-1' }]);
    await expect(
      hasActivePaidSubscription(db as never, 'user-1'),
    ).resolves.toBe(true);
  });

  it('is false when the user holds no current subscription row', async () => {
    const db = makeDb([]);
    await expect(
      hasActivePaidSubscription(db as never, 'user-1'),
    ).resolves.toBe(false);
  });

  it('scopes the lookup to the user, a current row and an unexpired one', async () => {
    const db = makeDb([]);

    await hasActivePaidSubscription(db as never, 'user-1');

    const { sql, params } = new PgDialect().sqlToQuery(db.calls.where as never);
    expect(sql).toContain('"user_id" = $1');
    expect(sql).toContain('"superseded_at" is null');
    expect(sql).toContain('"expires_at" > $2');
    // The dialect serialises the comparison Date to an ISO string.
    expect(params).toEqual(['user-1', expect.any(String)]);
  });
});

describe('activePaidSubscriptionExistsSql', () => {
  it('scopes to the user and only current, unexpired rows', () => {
    const query = new PgDialect().sqlToQuery(
      activePaidSubscriptionExistsSql(userSubscriptions.userId),
    );

    expect(query.sql).toContain('us.user_id = "user_subscriptions"."user_id"');
    expect(query.sql).toContain('us.superseded_at is null');
    expect(query.sql).toContain('us.expires_at > now()');
  });
});
