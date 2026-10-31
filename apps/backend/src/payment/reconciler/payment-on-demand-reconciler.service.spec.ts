import { PaymentOnDemandReconciler } from './payment-on-demand-reconciler.service';
import { runReconcileAttempt } from './run-reconcile-attempt';

// The Effect bridge is mocked at its Promise boundary — `effect` is ESM-only
// and Jest never needs to load it to test this service's own logic.
jest.mock('./run-reconcile-attempt', () => ({
  runReconcileAttempt: jest.fn(),
}));

const reconcileMock = runReconcileAttempt as unknown as jest.Mock;

/** A drizzle-style chain that resolves `rows` at `.limit()`. */
function chain(rows: unknown[]) {
  const self: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy']) {
    self[method] = jest.fn(() => self);
  }
  self.limit = jest.fn(() => Promise.resolve(rows));
  return self;
}

function build(opts: { attempts?: unknown[]; providers?: string[] } = {}) {
  const select = jest.fn(() => chain(opts.attempts ?? [{ id: 'att-1' }]));
  const outbox = { wakeupAfterCommit: jest.fn() };
  const config = {
    get: jest.fn((key: string) =>
      key === 'payment.reconcileProviders'
        ? (opts.providers ?? ['bakong'])
        : undefined,
    ),
  };
  const service = new PaymentOnDemandReconciler(
    { select } as never,
    {} as never,
    outbox as never,
    config as never,
  );
  return { service, select, outbox };
}

describe('PaymentOnDemandReconciler.refresh', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks the provider about the open attempt and reports a settle as changed', async () => {
    reconcileMock.mockResolvedValue('succeeded');
    const { service, outbox } = build();

    await expect(service.refresh('tx-1')).resolves.toBe('changed');

    expect(reconcileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentAttemptId: 'att-1' }),
    );
    // The settle enqueued payment.succeeded; wake the outbox like the poller does.
    expect(outbox.wakeupAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('reports a still-unpaid checkout as unchanged, without waking the outbox', async () => {
    reconcileMock.mockResolvedValue('still_pending');
    const { service, outbox } = build();

    await expect(service.refresh('tx-1')).resolves.toBe('unchanged');
    expect(outbox.wakeupAfterCommit).not.toHaveBeenCalled();
  });

  it.each(['abandoned', 'failed', 'skipped'])(
    'reports %s as changed, so the caller re-reads the transaction',
    async (outcome) => {
      reconcileMock.mockResolvedValue(outcome);
      const { service } = build();

      await expect(service.refresh('tx-1')).resolves.toBe('changed');
    },
  );

  it('calls the provider at most once per attempt per window, however often the page reads', async () => {
    reconcileMock.mockResolvedValue('still_pending');
    const { service } = build();

    expect(await service.refresh('tx-1')).toBe('unchanged');
    for (let i = 0; i < 9; i++) {
      expect(await service.refresh('tx-1')).toBe('throttled');
    }

    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it('asks again once the window has passed', async () => {
    reconcileMock.mockResolvedValue('still_pending');
    const { service } = build();
    await service.refresh('tx-1');

    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_006_000);

    expect(await service.refresh('tx-1')).toBe('unchanged');
    expect(reconcileMock).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a transaction with no open polled attempt', async () => {
    const { service } = build({ attempts: [] });

    await expect(service.refresh('tx-1')).resolves.toBe('none');
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('does nothing when no provider is configured to poll', async () => {
    const { service, select } = build({ providers: [] });

    await expect(service.refresh('tx-1')).resolves.toBe('none');
    expect(select).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('never throws: a provider failure is reported as error', async () => {
    reconcileMock.mockResolvedValue('error');
    const { service } = build();

    await expect(service.refresh('tx-1')).resolves.toBe('error');
  });

  it('never throws: a database failure is reported as error', async () => {
    const { service, select } = build();
    select.mockImplementation(() => {
      throw new Error('db down');
    });

    await expect(service.refresh('tx-1')).resolves.toBe('error');
  });

  it('gives up waiting on a slow provider so the page read is not held hostage', async () => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    reconcileMock.mockReturnValue(new Promise(() => undefined)); // never settles
    const { service } = build();

    const result = service.refresh('tx-1');
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe('unchanged');
    jest.useRealTimers();
  });
});
