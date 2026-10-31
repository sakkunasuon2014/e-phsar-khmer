import { Effect } from 'effect';
import type { ApiClient, ApiClientError } from '../../../../utils/api-client';
import type {
  CreatePurchaseRequest,
  CreatePurchaseResponse,
} from '../aba-payway.types';

const PURCHASE_PATH = 'api/payment-gateway/v1/payments/purchase';

/** The network call behind `charge()`; returns ABA's response as-is. */
export const createAbaPaywayTransaction = Effect.fn(
  'createAbaPaywayTransaction',
)(function* (
  apiClient: ApiClient,
  request: CreatePurchaseRequest,
): Effect.fn.Return<CreatePurchaseResponse, ApiClientError, never> {
  return yield* apiClient.post<CreatePurchaseResponse>(PURCHASE_PATH, request);
});
