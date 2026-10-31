import { Context, Layer } from 'effect';
import { PaymentGatewayRegistry } from './payment-gateway.registry';

/**
 * Effect-side handle for `PaymentGatewayRegistry`. Same mirror pattern as
 * `PaymentQueueTag`/`OutboxServiceTag` — wraps the NestJS-injected registry
 * so the processor's use-cases can `yield*` it instead of taking it as a
 * plain constructor parameter.
 */
export class PaymentGatewayRegistryTag extends Context.Service<
  PaymentGatewayRegistryTag,
  PaymentGatewayRegistry
>()('phsarkhmer/payment/PaymentGatewayRegistry') {
  static readonly layer = (registry: PaymentGatewayRegistry) =>
    Layer.succeed(PaymentGatewayRegistryTag, registry);
}
