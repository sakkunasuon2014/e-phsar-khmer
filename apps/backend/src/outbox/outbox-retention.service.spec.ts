import { OutboxRetention } from './outbox-retention.service';

function makeRetention(
  batches: number[],
  values: Record<string, unknown> = {},
) {
  const purgePublished = jest.fn<Promise<number>, [number, number]>();
  batches.forEach((n) => purgePublished.mockResolvedValueOnce(n));
  purgePublished.mockResolvedValue(0);
  const config = { get: jest.fn((key: string) => values[key]) };
  const retention = new OutboxRetention(
    { purgePublished } as never,
    config as never,
  );
  return { retention, purgePublished };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('OutboxRetention.sweep', () => {
  it('purges with the configured retention and stops on a short batch', async () => {
    const { retention, purgePublished } = makeRetention([1000, 1000, 3], {
      'outbox.retentionDays': 14,
    });

    await expect(retention.sweep()).resolves.toBe(2003);
    expect(purgePublished).toHaveBeenCalledTimes(3);
    expect(purgePublished).toHaveBeenCalledWith(14, 1000);
  });

  it('defaults retention to 7 days', async () => {
    const { retention, purgePublished } = makeRetention([0]);

    await retention.sweep();

    expect(purgePublished).toHaveBeenCalledWith(7, 1000);
  });

  it('caps one sweep at 50 batches so a huge backlog is spread over hours', async () => {
    const { retention, purgePublished } = makeRetention(
      Array<number>(60).fill(1000),
    );

    await expect(retention.sweep()).resolves.toBe(50_000);
    expect(purgePublished).toHaveBeenCalledTimes(50);
  });

  it('swallows a database error instead of crashing the timer', async () => {
    const { retention, purgePublished } = makeRetention([]);
    purgePublished.mockReset();
    purgePublished.mockRejectedValue(new Error('connection lost'));

    await expect(retention.sweep()).resolves.toBe(0);
  });
});

describe('OutboxRetention lifecycle', () => {
  it('leaves boot alone, sweeps within two minutes, then hourly', async () => {
    jest.useFakeTimers();
    const { retention, purgePublished } = makeRetention([]);

    retention.onApplicationBootstrap();
    await Promise.resolve();
    // A restart loop must not turn into a delete-query loop.
    expect(purgePublished).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(purgePublished).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgePublished).toHaveBeenCalledTimes(2);

    retention.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(purgePublished).toHaveBeenCalledTimes(2);
  });

  it('cancels a still-pending first sweep on shutdown', async () => {
    jest.useFakeTimers();
    const { retention, purgePublished } = makeRetention([]);

    retention.onApplicationBootstrap();
    retention.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);

    expect(purgePublished).not.toHaveBeenCalled();
  });

  it('does not run on an API-only instance', () => {
    const { retention, purgePublished } = makeRetention([], {
      'outbox.workerEnabled': false,
    });

    retention.onApplicationBootstrap();

    expect(purgePublished).not.toHaveBeenCalled();
  });

  it('does not run when retention is disabled', () => {
    const { retention, purgePublished } = makeRetention([], {
      'outbox.retentionDays': 0,
    });

    retention.onApplicationBootstrap();

    expect(purgePublished).not.toHaveBeenCalled();
  });
});
