import { OutboxService } from './outbox.service';
import type { IntegrationEvent } from './outbox.types';

/**
 * Covers `enqueue`'s branching, the wakeup signal, and the claim-side
 * stale-lease predicate. The claim/release methods are otherwise almost
 * entirely SQL — `FOR UPDATE SKIP LOCKED` semantics, `now()` arithmetic —
 * and asserting the shape of a drizzle builder chain beyond the due
 * predicate would test the mock rather than the behaviour. Those need an
 * integration test against a real Postgres, which this suite does not have.
 */
function makeExecutor(insertedRows: unknown[], existingRows: unknown[] = []) {
  const returning = jest.fn().mockResolvedValue(insertedRows);
  const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
  const values = jest
    .fn<{ onConflictDoNothing: jest.Mock }, [Record<string, unknown>]>()
    .mockReturnValue({ onConflictDoNothing });
  const insert = jest.fn().mockReturnValue({ values });

  const limit = jest.fn().mockResolvedValue(existingRows);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });

  return { executor: { insert, select }, values, select, limit };
}

function makeConfigService(values: Record<string, number> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

function makeService(
  config = makeConfigService(),
  eventEmitter: { emit: jest.Mock } = { emit: jest.fn() },
) {
  return new OutboxService({} as never, config as never, eventEmitter as never);
}

const event: IntegrationEvent = {
  eventType: 'test.thing.happened',
  aggregateType: 'thing',
  aggregateId: 'thing-1',
  payload: { hello: 'world' },
  dedupeKey: 'test.thing.happened:thing-1',
};

describe('OutboxService.enqueue', () => {
  it('writes through the executor it is handed, not the pooled client', async () => {
    const { executor, values } = makeExecutor([{ id: 'evt-1' }]);

    const row = await makeService().enqueue(executor as never, event);

    expect(row).toEqual({ id: 'evt-1' });
    expect(executor.insert).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        eventType: 'test.thing.happened',
        aggregateId: 'thing-1',
        dedupeKey: 'test.thing.happened:thing-1',
      }),
    );
  });

  it('applies the configured attempt budget', async () => {
    const { executor, values } = makeExecutor([{ id: 'evt-1' }]);
    const config = makeConfigService({ 'outbox.maxAttempts': 9 });

    await makeService(config).enqueue(executor as never, event);

    expect(values.mock.calls[0][0].maxAttempts).toBe(9);
  });

  it('lets an event override the budget for itself', async () => {
    const { executor, values } = makeExecutor([{ id: 'evt-1' }]);

    await makeService().enqueue(executor as never, {
      ...event,
      maxAttempts: 2,
    });

    expect(values.mock.calls[0][0].maxAttempts).toBe(2);
  });

  it('falls back to a default budget when nothing is configured', async () => {
    const { executor, values } = makeExecutor([{ id: 'evt-1' }]);

    await makeService().enqueue(executor as never, event);

    expect(values.mock.calls[0][0].maxAttempts).toBe(5);
  });

  it('returns the existing event when the dedupe key collides', async () => {
    const { executor, select } = makeExecutor([], [{ id: 'evt-original' }]);

    const row = await makeService().enqueue(executor as never, event);

    // The caller still needs an id it can dispatch against.
    expect(row).toEqual({ id: 'evt-original' });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('throws rather than returning nothing when an unkeyed insert produces no row', async () => {
    const { executor } = makeExecutor([]);
    const { dedupeKey, ...unkeyed } = event;
    void dedupeKey;

    await expect(
      makeService().enqueue(executor as never, unkeyed),
    ).rejects.toThrow(/Failed to enqueue outbox event/);
  });
});

describe('OutboxService.wakeupAfterCommit', () => {
  it('emits the local wakeup event after commit', () => {
    const emit = jest.fn();

    makeService(makeConfigService(), { emit }).wakeupAfterCommit();

    expect(emit).toHaveBeenCalledWith('outbox.wakeup');
  });
});

describe('OutboxService.claimDue', () => {
  it('claims rows that are pending-and-due or holding a stale lease', async () => {
    let capturedWhere: unknown;
    const returning = jest.fn().mockResolvedValue([]);
    const where = jest.fn((sqlArg: unknown) => {
      capturedWhere = sqlArg;
      return { returning };
    });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const db = { update };

    const service = new OutboxService(
      db as never,
      makeConfigService({ 'outbox.leaseTimeoutSeconds': 60 }) as never,
      { emit: jest.fn() } as never,
    );

    await service.claimDue(5);

    const rendered = stringifySql(capturedWhere);
    expect(rendered).toContain("'pending'");
    expect(rendered).toContain("'processing'");
    expect(rendered).toContain('locked_at');
    expect(rendered).toContain('60');
  });
});

describe('OutboxService.msUntilNextDue', () => {
  function serviceReturning(rows: unknown[]) {
    const where = jest.fn().mockResolvedValue(rows);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const service = new OutboxService(
      { select } as never,
      makeConfigService() as never,
      { emit: jest.fn() } as never,
    );
    return { service, select };
  }

  it('costs a single query', async () => {
    const { service, select } = serviceReturning([{ ms: '1500' }]);

    await service.msUntilNextDue();

    expect(select).toHaveBeenCalledTimes(1);
  });

  it('reads the number postgres.js returns for numeric as a string', async () => {
    const { service } = serviceReturning([{ ms: '1500' }]);

    await expect(service.msUntilNextDue()).resolves.toBe(1500);
  });

  it('is null when nothing is pending or leased', async () => {
    const { service } = serviceReturning([{ ms: null }]);

    await expect(service.msUntilNextDue()).resolves.toBeNull();
  });

  it('is null when the query returns no row at all', async () => {
    const { service } = serviceReturning([]);

    await expect(service.msUntilNextDue()).resolves.toBeNull();
  });

  it('clamps an already-due row to zero', async () => {
    const { service } = serviceReturning([{ ms: '-4200' }]);

    await expect(service.msUntilNextDue()).resolves.toBe(0);
  });

  it('treats an unparseable value as unknown rather than due', async () => {
    const { service } = serviceReturning([{ ms: 'soon' }]);

    await expect(service.msUntilNextDue()).resolves.toBeNull();
  });
});

describe('OutboxService.instanceId', () => {
  it('is unique per instance so a lease can be attributed', () => {
    expect(makeService().instanceId).not.toBe(makeService().instanceId);
  });
});

/** Renders a drizzle SQL object to a readable string for predicate assertions. */
function stringifySql(chunk: unknown): string {
  if (Array.isArray(chunk)) {
    return chunk.map(stringifySql).join('');
  }
  if (typeof chunk === 'object' && chunk !== null) {
    if ('queryChunks' in chunk) {
      return stringifySql(
        (chunk as { queryChunks: readonly unknown[] }).queryChunks,
      );
    }
    if ('value' in chunk) {
      const value = (chunk as { value: unknown }).value;
      return Array.isArray(value) ? value.join('') : String(value);
    }
    if (
      'name' in chunk &&
      typeof (chunk as { name: unknown }).name === 'string'
    ) {
      return (chunk as { name: string }).name;
    }
  }
  return String(chunk);
}
