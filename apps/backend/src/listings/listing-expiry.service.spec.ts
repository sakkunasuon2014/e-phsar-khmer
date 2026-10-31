import { PgDialect } from 'drizzle-orm/pg-core';
import { ListingExpiryService } from './listing-expiry.service';
import { DAY_MS } from './listing-expiry.constants';

type Rec = Record<string, unknown[]>;

function chain(result: unknown[], rec: Rec) {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
    c[m] = (...args: unknown[]) => {
      rec[m] = args;
      return c;
    };
  }
  c.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return c;
}

function setup() {
  const notify = jest.fn().mockResolvedValue(undefined);
  const recs: Rec[] = [];
  let results: unknown[][] = [];
  let call = 0;
  const db = {
    select: jest.fn(() => {
      const rec = recs[call] ?? {};
      if (call >= recs.length) recs.push(rec);
      const rows = results[call] ?? [];
      call++;
      return chain(rows, rec);
    }),
  };
  const service = new ListingExpiryService(db as never, { notify } as never);
  /** One entry per `db.select()` call, in the order the sweep makes them. */
  function queue(...rows: unknown[][]) {
    results = rows;
    recs.length = 0;
    call = 0;
  }
  return { service, notify, recs, queue };
}

describe('ListingExpiryService', () => {
  const now = new Date('2026-10-27T00:00:00.000Z');
  const dialect = new PgDialect();

  it('warns an owner whose ad expires within the window', async () => {
    const { service, notify, queue } = setup();
    const expiresAt = new Date(now.getTime() + 2 * DAY_MS);
    queue(
      [{ id: 'l1', userId: 'u1', title: 'Toy car', expiresAt }],
      [],
      [],
      [],
    );

    const result = await service.sweep(now);

    expect(result).toEqual({ expiring: 1, expired: 0 });
    expect(notify).toHaveBeenCalledWith({
      userId: 'u1',
      type: 'listing.expiring',
      title: 'Your ad "Toy car" expires in 2 days',
      body: 'Renew it from Manage Ads to keep it live in the marketplace.',
      data: { listingId: 'l1', expiresAt: expiresAt.toISOString(), days: 2 },
    });
  });

  it('does not repeat a warning for the same (listing, expiry)', async () => {
    const { service, notify, queue } = setup();
    const expiresAt = new Date(now.getTime() + 2 * DAY_MS);
    queue(
      [{ id: 'l1', userId: 'u1', title: 'Toy car', expiresAt }],
      [{ data: { listingId: 'l1', expiresAt: expiresAt.toISOString() } }],
      [],
      [],
    );

    const result = await service.sweep(now);

    expect(result.expiring).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('warns again after a renewal moved the expiry date', async () => {
    const { service, notify, queue } = setup();
    const expiresAt = new Date(now.getTime() + 2 * DAY_MS);
    const old = new Date(now.getTime() - 10 * DAY_MS).toISOString();
    queue(
      [{ id: 'l1', userId: 'u1', title: 'Toy car', expiresAt }],
      [{ data: { listingId: 'l1', expiresAt: old } }],
      [],
      [],
    );

    const result = await service.sweep(now);

    expect(result.expiring).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('tells the owner once when the ad has just lapsed', async () => {
    const { service, notify, queue } = setup();
    const lapsed = new Date(now.getTime() - 60_000);
    queue(
      [],
      [{ id: 'l2', userId: 'u2', title: 'Chair', expiresAt: lapsed }],
      [],
    );

    const result = await service.sweep(now);

    expect(result).toEqual({ expiring: 0, expired: 1 });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        type: 'listing.expired',
        title: 'Your ad "Chair" has expired',
        data: { listingId: 'l2', expiresAt: lapsed.toISOString() },
      }),
    );
  });

  it('bounds the expiring query to now < expires_at <= now + 3 days', async () => {
    const { service, recs, queue } = setup();
    queue([], []);

    await service.sweep(now);

    const until = new Date(now.getTime() + 3 * DAY_MS);
    const where = dialect.sqlToQuery(recs[0].where[0] as never);
    expect(where.sql).toContain('"expires_at" > $');
    expect(where.sql).toContain('"expires_at" <= $');
    expect(where.params).toEqual([
      'active',
      now.toISOString(),
      until.toISOString(),
    ]);
  });

  it('bounds the expired query to the last 24 hours', async () => {
    const { service, recs, queue } = setup();
    queue([], []);

    await service.sweep(now);

    const since = new Date(now.getTime() - DAY_MS);
    const where = dialect.sqlToQuery(recs[1].where[0] as never);
    expect(where.params).toEqual([
      'active',
      now.toISOString(),
      since.toISOString(),
    ]);
  });

  it('keeps sweeping when one notification fails', async () => {
    const { service, notify, queue } = setup();
    notify.mockRejectedValueOnce(new Error('redis down'));
    const expiresAt = new Date(now.getTime() + 2 * DAY_MS);
    queue(
      [
        { id: 'l1', userId: 'u1', title: 'Toy car', expiresAt },
        { id: 'l2', userId: 'u2', title: 'Lamp', expiresAt },
      ],
      [],
      [],
      [],
    );

    const result = await service.sweep(now);

    expect(result.expiring).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('leaves the listing untouched — expiry stays derived at read time', async () => {
    const { service, queue } = setup();
    const expiresAt = new Date(now.getTime() + 2 * DAY_MS);
    queue(
      [{ id: 'l1', userId: 'u1', title: 'Toy car', expiresAt }],
      [],
      [],
      [],
    );

    await service.sweep(now);

    // The fake db has no `update`: a sweep that tried to write would throw.
    expect(
      (service as unknown as { db: { update?: unknown } }).db.update,
    ).toBeUndefined();
  });
});
