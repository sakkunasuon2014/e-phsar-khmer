import { resolveProviderEventFailure } from './provider-event-failure';

describe('resolveProviderEventFailure', () => {
  const webhook = { failureCode: '1', failureMessage: undefined };

  it('records no failure on a succeeded attempt, even if the webhook said rejected', () => {
    expect(
      resolveProviderEventFailure('succeeded', webhook, {
        failureCode: undefined,
        failureMessage: undefined,
      }),
    ).toEqual({});
  });

  it("prefers the reconcile result's code and message over the webhook's raw status", () => {
    expect(
      resolveProviderEventFailure('failed', webhook, {
        failureCode: '5',
        failureMessage: 'DECLINED',
      }),
    ).toEqual({ failureCode: '5', failureMessage: 'DECLINED' });
  });

  it('falls back to the webhook for whatever the reconcile result lacks', () => {
    expect(
      resolveProviderEventFailure('failed', webhook, {
        failureCode: undefined,
        failureMessage: 'DECLINED',
      }),
    ).toEqual({ failureCode: '1', failureMessage: 'DECLINED' });
  });

  it('uses the webhook alone when the gateway has no reconcile()', () => {
    expect(resolveProviderEventFailure('failed', webhook)).toEqual({
      failureCode: '1',
      failureMessage: undefined,
    });
  });

  it('does not invent a failure from a webhook that reported approval but a reconcile that rejected', () => {
    expect(
      resolveProviderEventFailure(
        'failed',
        { failureCode: undefined, failureMessage: undefined },
        { failureCode: '3', failureMessage: 'EXPIRED' },
      ),
    ).toEqual({ failureCode: '3', failureMessage: 'EXPIRED' });
  });
});
