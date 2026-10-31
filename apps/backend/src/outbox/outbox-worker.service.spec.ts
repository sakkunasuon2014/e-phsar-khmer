import { Logger } from '@nestjs/common';
import { OutboxWorker } from './outbox-worker.service';
import type { DispatchOutcome } from './outbox.types';

function outcome(status: DispatchOutcome['status'], id: string) {
  return { eventId: id, eventType: 'test.event', status };
}

function makeDispatcher(...batches: DispatchOutcome[][]) {
  const dispatchDue = jest.fn<Promise<DispatchOutcome[]>, [number]>();
  batches.forEach((b) => dispatchDue.mockResolvedValueOnce(b));
  dispatchDue.mockResolvedValue([]);
  return { dispatcher: { dispatchDue }, dispatchDue };
}

function makeConfigService(values: Record<string, unknown> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

/**
 * `peeks` are the successive answers of `OutboxService.msUntilNextDue()`;
 * once they run out it answers `null` ("nothing waiting").
 */
function makeOutbox(...peeks: Array<number | null | Error>) {
  const msUntilNextDue = jest.fn<Promise<number | null>, []>();
  peeks.forEach((p) =>
    p instanceof Error
      ? msUntilNextDue.mockRejectedValueOnce(p)
      : msUntilNextDue.mockResolvedValueOnce(p),
  );
  msUntilNextDue.mockResolvedValue(null);
  return { instanceId: 'test-instance', msUntilNextDue };
}

function makeWorker(
  dispatcher: { dispatchDue: jest.Mock },
  values: Record<string, unknown> = {},
  outbox: ReturnType<typeof makeOutbox> = makeOutbox(),
) {
  return new OutboxWorker(
    dispatcher as never,
    outbox as never,
    makeConfigService(values) as never,
  );
}

function waiterCount(worker: OutboxWorker): number {
  return (worker as unknown as { wakeupSignal: { waiters: Set<unknown> } })
    .wakeupSignal.waiters.size;
}

/** Drains microtasks (and lets worker loops reach their next await) on real timers. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  jest.useRealTimers();
});

describe('OutboxWorker.runOnce', () => {
  it('drains a batch and reports how many events it handled', async () => {
    const { dispatcher } = makeDispatcher([
      outcome('published', 'evt-1'),
      outcome('published', 'evt-2'),
    ]);

    await expect(makeWorker(dispatcher).runOnce()).resolves.toBe(2);
  });

  it('asks for the configured batch size', async () => {
    const { dispatcher, dispatchDue } = makeDispatcher([]);

    await makeWorker(dispatcher, { 'outbox.batchSize': 25 }).runOnce();

    expect(dispatchDue).toHaveBeenCalledWith(25);
  });

  it('defaults the batch size when nothing is configured', async () => {
    const { dispatcher, dispatchDue } = makeDispatcher([]);

    await makeWorker(dispatcher).runOnce();

    expect(dispatchDue).toHaveBeenCalledWith(10);
  });

  it('reports failures without throwing', async () => {
    const { dispatcher } = makeDispatcher([outcome('failed', 'evt-9')]);

    await expect(makeWorker(dispatcher).runOnce()).resolves.toBe(1);
  });
});

describe('OutboxWorker lifecycle', () => {
  const started = {
    'outbox.workerEnabled': true,
    'outbox.workerConcurrency': 2,
    'outbox.pollIntervalMs': 60_000,
  };

  it('does not start when the worker is disabled', async () => {
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    const outbox = makeOutbox();
    const worker = makeWorker(
      dispatcher,
      { 'outbox.workerEnabled': false },
      outbox,
    );

    worker.onApplicationBootstrap();
    await worker.onModuleDestroy();

    expect(dispatchDue).not.toHaveBeenCalled();
    expect(outbox.msUntilNextDue).not.toHaveBeenCalled();
  });

  it('boots against an empty table with one cheap peek and no claim', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    const outbox = makeOutbox();
    const worker = makeWorker(dispatcher, started, outbox);

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    expect(outbox.msUntilNextDue).toHaveBeenCalledTimes(1);
    expect(dispatchDue).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
  });

  it('claims at boot when the peek says a backlog is already due', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    const worker = makeWorker(dispatcher, started, makeOutbox(0));

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    expect(dispatchDue).toHaveBeenCalledTimes(1);
    await worker.onModuleDestroy();
  });

  it('a wakeup triggers a dispatch without waiting for any timer', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    const worker = makeWorker(dispatcher, {
      ...started,
      'outbox.workerConcurrency': 1,
    });

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(dispatchDue).not.toHaveBeenCalled();

    worker.wakeup();
    await jest.advanceTimersByTimeAsync(0);
    expect(dispatchDue).toHaveBeenCalledTimes(1);

    await worker.onModuleDestroy();
  });

  it('makes no claim queries at all while the table stays empty', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    const outbox = makeOutbox();
    const worker = makeWorker(dispatcher, started, outbox);

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10 * 60_000);

    expect(dispatchDue).not.toHaveBeenCalled();
    // One heartbeat peek a minute (plus boot) — not one query every 2 s.
    expect(outbox.msUntilNextDue.mock.calls.length).toBeLessThanOrEqual(12);
    await worker.onModuleDestroy();
  });

  it('sleeps until the next row is due instead of polling for it', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    // Boot: a retry is due in 5 s. At that point the peek says "now".
    const outbox = makeOutbox(5_000, 0);
    const worker = makeWorker(dispatcher, started, outbox);

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(4_000);
    expect(dispatchDue).not.toHaveBeenCalled();
    expect(outbox.msUntilNextDue).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_500);
    expect(dispatchDue).toHaveBeenCalledTimes(1);
    await worker.onModuleDestroy();
  });

  it('recovers a lost wakeup within one heartbeat', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    // Boot sees nothing; a row inserted by another process shows up at the
    // first heartbeat.
    const outbox = makeOutbox(null, 0);
    const worker = makeWorker(dispatcher, started, outbox);

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(59_000);
    expect(dispatchDue).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2_000);
    expect(dispatchDue).toHaveBeenCalledTimes(1);
    await worker.onModuleDestroy();
  });

  it('re-arms from the database after handling events, so a backoff retry is not left to the heartbeat', async () => {
    jest.useFakeTimers();
    // The drain handles one event, which its handler pushes 1 s into the future.
    const { dispatcher, dispatchDue } = makeDispatcher([
      outcome('retry', 'evt-1'),
    ]);
    const outbox = makeOutbox(0, 1_000, 0);
    const worker = makeWorker(
      dispatcher,
      { ...started, 'outbox.workerConcurrency': 1 },
      outbox,
    );

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(dispatchDue).toHaveBeenCalledTimes(1);

    // Well inside the 60 s heartbeat.
    await jest.advanceTimersByTimeAsync(2_000);
    expect(dispatchDue).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
  });

  it('falls back to a plain claim when the peek fails, and keeps its heartbeat', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    const outbox = makeOutbox(new Error('peek is broken'), 0);
    const worker = makeWorker(dispatcher, started, outbox);

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    // A broken peek must never leave due rows unclaimed: claim anyway.
    expect(dispatchDue).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(61_000);
    expect(outbox.msUntilNextDue).toHaveBeenCalledTimes(2);
    expect(dispatchDue).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
  });

  it('keeps draining after a claim throws', async () => {
    jest.useFakeTimers();
    const dispatchDue = jest
      .fn<Promise<DispatchOutcome[]>, [number]>()
      .mockRejectedValueOnce(new Error('database is down'))
      .mockResolvedValue([]);
    const worker = makeWorker({ dispatchDue }, started, makeOutbox(0, 0));

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(61_000);

    expect(dispatchDue).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
  });

  it('goes straight back for another batch when the last one came back full', async () => {
    jest.useFakeTimers();
    const full = Array.from({ length: 10 }, (_, i) =>
      outcome('published', `evt-${i}`),
    );
    const { dispatcher, dispatchDue } = makeDispatcher(full);
    const worker = makeWorker(
      dispatcher,
      { ...started, 'outbox.workerConcurrency': 1, 'outbox.batchSize': 10 },
      makeOutbox(0),
    );

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    // Full batch → immediate second dispatch, not a 60 s wait.
    await jest.advanceTimersByTimeAsync(1);

    expect(dispatchDue).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
  });

  it('keeps the pool bounded: never more dispatches in flight than concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    const dispatchDue = jest.fn(async (): Promise<DispatchOutcome[]> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      active -= 1;
      return [];
    });

    const worker = makeWorker(
      { dispatchDue },
      { ...started, 'outbox.workerConcurrency': 3 },
    );

    worker.onApplicationBootstrap();
    await flush();
    // Three wakeups reach the three parked workers.
    worker.wakeup();
    worker.wakeup();
    worker.wakeup();
    await flush();
    expect(active).toBe(3);
    expect(maxActive).toBe(3);

    // Extra wakeups while every worker is busy must not spawn more dispatches.
    worker.wakeup();
    worker.wakeup();
    worker.wakeup();
    await flush();
    expect(active).toBe(3);
    expect(maxActive).toBe(3);

    resolvers.splice(0).forEach((resolve) => resolve());
    await flush();
    // A wakeup buffered while all workers were busy must trigger a follow-up
    // drain once capacity is available.
    expect(dispatchDue).toHaveBeenCalledTimes(4);
    resolvers.splice(0).forEach((resolve) => resolve());
    await flush();
    await worker.onModuleDestroy();
  });

  it('a check that finds due work wakes the idle peers too', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([
      outcome('published', 'evt-found'),
      outcome('published', 'evt-found-2'),
    ]);
    const worker = makeWorker(
      dispatcher,
      { ...started, 'outbox.workerConcurrency': 3, 'outbox.batchSize': 2 },
      makeOutbox(0),
    );

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(0);

    // One worker found a full batch and fanned out to its two idle peers.
    expect(dispatchDue.mock.calls.length).toBeGreaterThanOrEqual(3);
    await worker.onModuleDestroy();
  });

  it('keeps running while one worker is stuck in a hung handler', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const dispatchDue = jest.fn(async (): Promise<DispatchOutcome[]> => {
      calls += 1;
      // The very first claim never settles: that worker is gone for good.
      if (calls === 1) await new Promise<void>(() => undefined);
      return [];
    });
    const worker = makeWorker({ dispatchDue }, started, makeOutbox(null, 0));

    worker.onApplicationBootstrap();
    worker.wakeup();
    await jest.advanceTimersByTimeAsync(0);
    // A wakeup reaches both parked workers; the first one never comes back.
    expect(dispatchDue).toHaveBeenCalledTimes(2);

    // The heartbeat is independent of the hung worker and reaches the other.
    await jest.advanceTimersByTimeAsync(61_000);
    expect(dispatchDue).toHaveBeenCalledTimes(3);

    // Shutdown gives the hung worker its grace period, then gives up on it.
    const destroyed = worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10_000);
    await destroyed;
  });

  it('stops checking on shutdown', async () => {
    jest.useFakeTimers();
    const { dispatcher } = makeDispatcher([]);
    const outbox = makeOutbox();
    const worker = makeWorker(dispatcher, started, outbox);

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    await worker.onModuleDestroy();
    const after = outbox.msUntilNextDue.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10 * 60_000);

    expect(outbox.msUntilNextDue).toHaveBeenCalledTimes(after);
  });

  it('releases parked workers on shutdown without starting another drain', async () => {
    jest.useFakeTimers();
    const { dispatcher, dispatchDue } = makeDispatcher([]);
    const worker = makeWorker(dispatcher, {
      ...started,
      'outbox.workerConcurrency': 3,
    });

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(waiterCount(worker)).toBe(3);

    await worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(0);

    expect(dispatchDue).not.toHaveBeenCalled();
    expect(waiterCount(worker)).toBe(0);
  });
});

describe('OutboxWorker stats', () => {
  const started = {
    'outbox.workerEnabled': true,
    'outbox.workerConcurrency': 1,
    'outbox.pollIntervalMs': 60_000,
  };

  it('counts checks, drains and handled events', async () => {
    jest.useFakeTimers();
    const { dispatcher } = makeDispatcher([
      outcome('published', 'a'),
      outcome('published', 'b'),
    ]);
    const worker = makeWorker(dispatcher, started, makeOutbox(0));

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    const stats = worker.getStats();
    expect(stats.drains).toBe(1);
    expect(stats.events).toBe(2);
    expect(stats.checks).toBeGreaterThanOrEqual(1);
    await worker.onModuleDestroy();
  });

  it('logs a summary line every ten minutes and starts a new window', async () => {
    jest.useFakeTimers();
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { dispatcher } = makeDispatcher([]);
    const worker = makeWorker(dispatcher, started);

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(11 * 60_000);

    const summaries = log.mock.calls.filter(([m]) =>
      String(m).startsWith('Outbox stats'),
    );
    expect(summaries).toHaveLength(1);
    expect(worker.getStats().checks).toBeLessThan(11);

    await worker.onModuleDestroy();
    log.mockRestore();
  });
});
