import { Effect } from 'effect';
import type { ApiClient, ApiClientError } from '../../../../utils/api-client';
import type {
  CheckTransactionRequest,
  CheckTransactionResponse,
} from '../aba-payway.types';

const CHECK_TRANSACTION_PATH =
  'api/payment-gateway/v1/payments/check-transaction-2';

/** The network call behind `reconcile()`; returns ABA's response as-is. */
export const checkAbaPaywayTransaction = Effect.fn('checkAbaPaywayTransaction')(
  function* (
    apiClient: ApiClient,
    request: CheckTransactionRequest,
  ): Effect.fn.Return<CheckTransactionResponse, ApiClientError, never> {
    return yield* apiClient.post<CheckTransactionResponse>(
      CHECK_TRANSACTION_PATH,
      request,
    );
  },
);
