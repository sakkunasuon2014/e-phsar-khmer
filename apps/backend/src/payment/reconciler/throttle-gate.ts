/**
 * "At most one per key per window", in memory. Used to keep a payer's page
 * refreshes from turning into a provider call each: the first read inside a
 * window asks the provider, the rest are answered from the database.
 *
 * Per process, not global — under several instances the ceiling is one call
 * per window per instance. That is acceptable here: it bounds abuse and load,
 * while settlement correctness never depends on it (the reconciler is the
 * guarantee, and every settle path is idempotent).
 */
export class ThrottleGate {
  private readonly lastAt = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    /** Prune expired keys once the table reaches this size. */
    private readonly maxKeys = 1_000,
  ) {}

  get size(): number {
    return this.lastAt.size;
  }

  /** `true` when the caller may proceed; a rejected call does not extend the window. */
  tryAcquire(key: string, now: number): boolean {
    const previous = this.lastAt.get(key);
    if (previous !== undefined && now - previous < this.windowMs) {
      return false;
    }
    if (this.lastAt.size >= this.maxKeys) this.prune(now);
    this.lastAt.set(key, now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, at] of this.lastAt) {
      if (now - at >= this.windowMs) this.lastAt.delete(key);
    }
  }
}
