import { Job } from 'bullmq';
import {
  CONFIG_RECONCILE_JOB_ID,
  CONFIG_RECONCILE_NEXT_JOB_ID,
  EntitlementsScheduler,
} from './entitlements.scheduler';
import { LISTING_SWEEP_JOB } from './entitlements.constants';

const options = (jobId: string) => ({
  jobId,
  removeOnComplete: true,
  removeOnFail: true,
});

function schedulerWith(current: { isActive: () => Promise<boolean> } | null) {
  const add = jest.fn().mockResolvedValue(undefined);
  const getJob = jest.fn().mockResolvedValue(current);
  return {
    add,
    getJob,
    scheduler: new EntitlementsScheduler({ add, getJob } as never),
  };
}

describe('EntitlementsScheduler.enqueueConfigReconcile', () => {
  it.each([CONFIG_RECONCILE_JOB_ID, CONFIG_RECONCILE_NEXT_JOB_ID])(
    'uses a job id BullMQ accepts (%s)',
    (jobId) => {
      // BullMQ throws "Custom Id cannot contain :"; the scheduler swallows
      // enqueue errors, so a bad id would silently never enqueue.
      expect(jobId).not.toContain(':');
      const job = new Job(
        { opts: {}, toKey: () => '', qualifiedName: 'q' } as never,
        'n',
        {},
        { jobId },
      );
      // `validateOptions` is protected but is what `Queue.add` runs first.
      const target = job as unknown as { validateOptions(data: object): void };
      expect(() => {
        target.validateOptions({});
      }).not.toThrow();
    },
  );

  it('enqueues the coalescing job when none exists', async () => {
    const { add, scheduler } = schedulerWith(null);

    await scheduler.enqueueConfigReconcile();

    expect(add).toHaveBeenCalledWith(
      LISTING_SWEEP_JOB,
      {},
      options(CONFIG_RECONCILE_JOB_ID),
    );
  });

  it('reuses the same id while that job is only waiting, so a burst collapses', async () => {
    const { add, scheduler } = schedulerWith({
      isActive: () => Promise.resolve(false),
    });

    await scheduler.enqueueConfigReconcile();

    expect(add).toHaveBeenCalledWith(
      LISTING_SWEEP_JOB,
      {},
      options(CONFIG_RECONCILE_JOB_ID),
    );
  });

  it('queues behind a running job instead of being dropped, since it may have read stale config', async () => {
    const { add, scheduler } = schedulerWith({
      isActive: () => Promise.resolve(true),
    });

    await scheduler.enqueueConfigReconcile();

    expect(add).toHaveBeenCalledWith(
      LISTING_SWEEP_JOB,
      {},
      options(CONFIG_RECONCILE_NEXT_JOB_ID),
    );
  });

  it('swallows enqueue failures because the recurring sweep is the backstop', async () => {
    const scheduler = new EntitlementsScheduler({
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockRejectedValue(new Error('redis down')),
    } as never);

    await expect(scheduler.enqueueConfigReconcile()).resolves.toBeUndefined();
  });

  it('swallows lookup failures too', async () => {
    const scheduler = new EntitlementsScheduler({
      getJob: jest.fn().mockRejectedValue(new Error('redis down')),
      add: jest.fn(),
    } as never);

    await expect(scheduler.enqueueConfigReconcile()).resolves.toBeUndefined();
  });
});
