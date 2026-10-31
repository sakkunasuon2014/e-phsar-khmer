import { EntitlementsProcessor } from './entitlements-sweep.processor';
import { LISTING_SWEEP_JOB } from './entitlements.constants';

describe('EntitlementsProcessor', () => {
  it('reconciles all users for a sweep job', async () => {
    const reconcileAll = jest.fn().mockResolvedValue(3);
    const processor = new EntitlementsProcessor({ reconcileAll } as never);

    await expect(
      processor.process({ name: LISTING_SWEEP_JOB } as never),
    ).resolves.toEqual({ users: 3 });
    expect(reconcileAll).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown jobs', async () => {
    const reconcileAll = jest.fn();
    const processor = new EntitlementsProcessor({ reconcileAll } as never);

    await expect(
      processor.process({ name: 'other' } as never),
    ).resolves.toEqual({ users: 0 });
    expect(reconcileAll).not.toHaveBeenCalled();
  });
});
