export type WakeupWaitResult = 'signaled' | 'closed';

/** A coalescing, process-local indication that the outbox may have work. */
export class WakeupSignal {
  private pending = false;
  private closed = false;
  private readonly waiters = new Set<{
    resolve: (result: WakeupWaitResult) => void;
  }>();

  notify(): void {
    if (this.closed) return;

    if (this.waiters.size === 0) {
      this.pending = true;
      return;
    }

    this.notifyWaiters();
  }

  /**
   * Wakes a single parked worker, or leaves a pending token when every worker
   * is busy. Used by the fallback timer so one tick costs one claim query.
   */
  notifyOne(): void {
    if (this.closed) return;

    const [waiter] = this.waiters;
    if (!waiter) {
      this.pending = true;
      return;
    }

    this.removeWaiter(waiter);
    waiter.resolve('signaled');
  }

  /** Wakes only parked workers; used by the fallback poll to avoid waking itself. */
  notifyWaiters(): void {
    if (this.closed) return;

    for (const waiter of this.waiters) {
      this.removeWaiter(waiter);
      waiter.resolve('signaled');
    }
  }

  wait(): Promise<WakeupWaitResult> {
    if (this.closed) return Promise.resolve('closed');
    if (this.pending) {
      this.pending = false;
      return Promise.resolve('signaled');
    }

    return new Promise((resolve) => {
      this.waiters.add({ resolve });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = false;

    for (const waiter of this.waiters) {
      this.removeWaiter(waiter);
      waiter.resolve('closed');
    }
  }

  private removeWaiter(waiter: {
    resolve: (result: WakeupWaitResult) => void;
  }): void {
    this.waiters.delete(waiter);
  }
}
