export interface FailureDetails {
  failureCode?: string;
  failureMessage?: string;
}

/**
 * Failure code/message to record on the attempt. `outcome` is the reconciled
 * one when the gateway can reconcile, so the details come from there too: the
 * webhook only has a raw status code, and can even contradict `outcome`. The
 * webhook's values are just a fallback.
 */
export function resolveProviderEventFailure(
  outcome: 'succeeded' | 'failed',
  parsed: FailureDetails,
  reconciled?: FailureDetails,
): FailureDetails {
  if (outcome === 'succeeded') return {};
  return {
    failureCode: reconciled?.failureCode ?? parsed.failureCode,
    failureMessage: reconciled?.failureMessage ?? parsed.failureMessage,
  };
}
