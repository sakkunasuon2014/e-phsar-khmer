import type { OutboxEventRow } from '../../db/schema/outbox.schema';
import { PaymentPollOutboxHandler } from './payment-poll-outbox-handler';

function event(payload: Record<string, unknown>): OutboxEventRow {
  return { id: 'evt-1', payload } as unknown as OutboxEventRow;
}

describe('PaymentPollOutboxHandler (legacy drain)', () => {
  const payload = {
    paymentTransactionId: 'tx-1',
    paymentAttemptId: 'att-1',
    intervalMs: 4_000,
    expiresAt: 123,
  };

  it('registers itself so queued rows have a handler instead of retrying to failure', () => {
    const register = jest.fn();
    const handler = new PaymentPollOutboxHandler({ register } as never);

    handler.onModuleInit();

    expect(register).toHaveBeenCalledWith(handler);
  });

  it('marks a leftover poll row published without scheduling any work', async () => {
    const handler = new PaymentPollOutboxHandler({
      register: jest.fn(),
    } as never);

    await expect(handler.handle(event(payload))).resolves.toEqual({
      status: 'published',
    });
  });

  it('drains rows in the old back-off shape too', async () => {
    const handler = new PaymentPollOutboxHandler({
      register: jest.fn(),
    } as never);

    await expect(
      handler.handle(event({ ...payload, round: 6, delayMs: 8_000 })),
    ).resolves.toEqual({ status: 'published' });
  });
});
