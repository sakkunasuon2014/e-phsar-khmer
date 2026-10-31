import { WakeupSignal } from './wakeup-signal';

describe('WakeupSignal', () => {
  it('coalesces notifications while nobody is waiting', async () => {
    const signal = new WakeupSignal();
    signal.notify();
    signal.notify();

    await expect(signal.wait()).resolves.toBe('signaled');
    expect(signal['pending']).toBe(false);
  });

  it('broadcasts to all parked workers without retaining a pending token', async () => {
    const signal = new WakeupSignal();
    const first = signal.wait();
    const second = signal.wait();

    signal.notify();

    await expect(Promise.all([first, second])).resolves.toEqual([
      'signaled',
      'signaled',
    ]);
    expect(signal['pending']).toBe(false);
  });

  it('does not retain a fallback-only notification when no peer is parked', () => {
    const signal = new WakeupSignal();
    signal.notifyWaiters();

    expect(signal['pending']).toBe(false);
    expect(signal['waiters'].size).toBe(0);
  });

  it('notifyOne wakes a single waiter, or leaves a pending token when none are parked', async () => {
    const signal = new WakeupSignal();
    signal.notifyOne();
    expect(signal['pending']).toBe(true);
    await expect(signal.wait()).resolves.toBe('signaled');

    const first = signal.wait();
    const second = signal.wait();
    signal.notifyOne();

    await expect(first).resolves.toBe('signaled');
    expect(signal['waiters'].size).toBe(1);
    signal.close();
    await expect(second).resolves.toBe('closed');
  });

  it('closes idempotently, clears pending work, and ignores later notifications', async () => {
    const signal = new WakeupSignal();
    const first = signal.wait();
    const second = signal.wait();

    signal.close();
    signal.close();
    signal.notify();

    await expect(Promise.all([first, second])).resolves.toEqual([
      'closed',
      'closed',
    ]);
    await expect(signal.wait()).resolves.toBe('closed');
    expect(signal['waiters'].size).toBe(0);
  });
});
