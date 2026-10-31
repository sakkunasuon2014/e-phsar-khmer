import { ThrottleGate } from './throttle-gate';

describe('ThrottleGate', () => {
  it('lets the first caller for a key through', () => {
    const gate = new ThrottleGate(5_000);

    expect(gate.tryAcquire('a', 1_000)).toBe(true);
  });

  it('turns away repeat callers for the same key inside the window', () => {
    const gate = new ThrottleGate(5_000);
    gate.tryAcquire('a', 1_000);

    expect(gate.tryAcquire('a', 1_001)).toBe(false);
    expect(gate.tryAcquire('a', 5_999)).toBe(false);
  });

  it('lets a key through again once the window has passed', () => {
    const gate = new ThrottleGate(5_000);
    gate.tryAcquire('a', 1_000);

    expect(gate.tryAcquire('a', 6_000)).toBe(true);
  });

  it('keeps keys independent', () => {
    const gate = new ThrottleGate(5_000);
    gate.tryAcquire('a', 1_000);

    expect(gate.tryAcquire('b', 1_001)).toBe(true);
  });

  it('does not extend the window when a caller is turned away', () => {
    const gate = new ThrottleGate(5_000);
    gate.tryAcquire('a', 1_000);
    gate.tryAcquire('a', 4_000); // rejected: must not restart the clock

    expect(gate.tryAcquire('a', 6_000)).toBe(true);
  });

  it('forgets expired keys instead of growing without bound', () => {
    const gate = new ThrottleGate(1_000, 3);
    gate.tryAcquire('a', 0);
    gate.tryAcquire('b', 0);
    gate.tryAcquire('c', 0);

    // Table is full; everything in it has expired, so it is pruned on insert.
    gate.tryAcquire('d', 5_000);

    expect(gate.size).toBe(1);
  });
});
