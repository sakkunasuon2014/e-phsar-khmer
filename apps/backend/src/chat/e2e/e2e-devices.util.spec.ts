import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '../../db/drizzle.provider';
import {
  diffDevices,
  loadTargetDevices,
  lockE2eDeviceKeys,
  pickTargetDevices,
} from './e2e-devices.util';
import type { DeviceCandidate } from './e2e-devices.util';

const day = (n: number) => new Date(Date.UTC(2026, 9, n));
const candidate = (
  id: string,
  userId: string,
  seenDay: number,
  fresh: boolean,
): DeviceCandidate => ({ id, userId, lastSeenAt: day(seenDay), fresh });

describe('pickTargetDevices', () => {
  it('keeps only the fresh devices when a user has any (stale ones excluded)', () => {
    expect(
      pickTargetDevices([
        candidate('stale', 'u1', 1, false),
        candidate('fresh-old', 'u1', 20, true),
        candidate('fresh-new', 'u1', 25, true),
      ]),
    ).toEqual([
      { id: 'fresh-new', userId: 'u1' },
      { id: 'fresh-old', userId: 'u1' },
    ]);
  });

  it('falls back to the two most recently seen devices when all are stale', () => {
    expect(
      pickTargetDevices([
        candidate('oldest', 'u1', 1, false),
        candidate('newest', 'u1', 9, false),
        candidate('middle', 'u1', 5, false),
      ]),
    ).toEqual([
      { id: 'newest', userId: 'u1' },
      { id: 'middle', userId: 'u1' },
    ]);
  });

  it('keeps a single stale device (the account stays targetable)', () => {
    expect(pickTargetDevices([candidate('only', 'u2', 1, false)])).toEqual([
      { id: 'only', userId: 'u2' },
    ]);
  });

  it('returns nothing for a user with no candidates (never registered or all revoked)', () => {
    expect(pickTargetDevices([])).toEqual([]);
  });

  it('decides per user: one fresh user does not suppress the fallback of another', () => {
    const picked = pickTargetDevices([
      candidate('me-fresh', 'me', 25, true),
      candidate('me-stale', 'me', 1, false),
      candidate('peer-a', 'peer', 2, false),
      candidate('peer-b', 'peer', 3, false),
      candidate('peer-c', 'peer', 4, false),
    ]);
    expect(picked).toEqual([
      { id: 'me-fresh', userId: 'me' },
      { id: 'peer-c', userId: 'peer' },
      { id: 'peer-b', userId: 'peer' },
    ]);
  });

  it('breaks lastSeenAt ties by id so every caller computes the same set', () => {
    const rows = [
      candidate('b', 'u1', 3, false),
      candidate('c', 'u1', 3, false),
      candidate('a', 'u1', 3, false),
    ];
    const forward = pickTargetDevices(rows);
    const reversed = pickTargetDevices([...rows].reverse());
    expect(forward).toEqual(reversed);
    expect(forward).toHaveLength(2);
  });
});

describe('loadTargetDevices', () => {
  function executorReturning(rows: DeviceCandidate[]) {
    const wheres: SQL[] = [];
    const select = jest.fn(() => ({
      from: () => ({
        where: (cond: SQL) => {
          wheres.push(cond);
          return Promise.resolve(rows);
        },
      }),
    }));
    return { executor: { select } as unknown as DbExecutor, select, wheres };
  }

  it('does not query when no users are given', async () => {
    const { executor, select } = executorReturning([]);
    await expect(loadTargetDevices(executor, [])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('reads only non-revoked devices of the given users and applies the pick rule', async () => {
    const { executor, wheres } = executorReturning([
      candidate('a', 'u1', 1, false),
      candidate('b', 'u1', 2, false),
      candidate('c', 'u1', 3, false),
    ]);

    const picked = await loadTargetDevices(executor, ['u1']);

    expect(picked).toEqual([
      { id: 'c', userId: 'u1' },
      { id: 'b', userId: 'u1' },
    ]);
    const { sql } = new PgDialect().sqlToQuery(wheres[0]);
    expect(sql).toContain('"revoked_at" is null');
    // Staleness is no longer a filter: it only decides between the fresh set
    // and the fallback, so a quiet account is still returned.
    expect(sql).not.toContain('last_seen_at');
  });
});

describe('diffDevices', () => {
  const expected = [
    { userId: 'peer', deviceId: 'p1' },
    { userId: 'peer', deviceId: 'p2' },
    { userId: 'me', deviceId: 'm2' },
  ];

  it('reports nothing when the sets match (order-insensitive)', () => {
    expect(diffDevices(expected, ['m2', 'p2', 'p1'])).toEqual({
      missing: [],
      stale: [],
    });
  });

  it('reports a newly added device as missing', () => {
    expect(diffDevices(expected, ['p1', 'm2'])).toEqual({
      missing: [{ userId: 'peer', deviceId: 'p2' }],
      stale: [],
    });
  });

  it('reports a revoked device as stale', () => {
    expect(diffDevices(expected, ['p1', 'p2', 'm2', 'gone'])).toEqual({
      missing: [],
      stale: ['gone'],
    });
  });

  it('reports both at once (device swapped)', () => {
    expect(diffDevices(expected, ['p1', 'old', 'm2'])).toEqual({
      missing: [{ userId: 'peer', deviceId: 'p2' }],
      stale: ['old'],
    });
  });
});

describe('lockE2eDeviceKeys', () => {
  it('locks the per-user device keys in ascending key order', async () => {
    const queries: SQL[] = [];
    const execute = jest.fn((query: SQL) => {
      queries.push(query);
      return Promise.resolve([]);
    });
    await lockE2eDeviceKeys({ execute } as unknown as DbExecutor, ['u2', 'u1']);

    // One statement, both participants: a send must hold the sender's and the
    // recipient's locks for its whole in-transaction re-read + insert.
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql, params } = new PgDialect().sqlToQuery(queries[0]);
    // Sorted (input was u2 then u1) — the ordering every lock-taker shares,
    // which is what makes concurrent transactions deadlock-free.
    expect(params).toEqual(['e2e-devices:u1', 'e2e-devices:u2']);
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(key, 0))');
    expect(sql).toContain('order by 1');
  });
});
