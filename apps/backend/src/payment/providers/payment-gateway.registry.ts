import { Inject, Injectable } from '@nestjs/common';
import {
  PAYMENT_GATEWAY_PROVIDERS,
  type PaymentGatewayProvider,
} from './payment-gateway.interface';
import type { PaymentProviderName } from './payment-gateway.types';

/**
 * Resolves a PaymentGatewayProvider by the plain `provider` string stored on
 * a payment row. Adding a new bank is registering one more provider against
 * PAYMENT_GATEWAY_PROVIDERS in payment.module.ts — nothing here changes.
 */
@Injectable()
export class PaymentGatewayRegistry {
  private readonly providers = new Map<string, PaymentGatewayProvider>();

  constructor(
    // The plain array registered under this token in payment.module.ts.
    @Inject(PAYMENT_GATEWAY_PROVIDERS) providers: PaymentGatewayProvider[],
  ) {
    for (const provider of providers) {
      this.providers.set(provider.name, provider);
    }
  }

  /**
   * Every registered provider, for a checkout's provider picker.
   * `available` is `isConfigured()` (missing implementation = configured,
   * per that method's contract) so a client can show a provider without
   * letting a payer pick one whose charge() would only fail in the queue.
   */
  list(): {
    name: PaymentProviderName;
    displayName: string;
    available: boolean;
  }[] {
    return [...this.providers.values()].map((provider) => ({
      name: provider.name,
      displayName: provider.displayName,
      available: provider.isConfigured?.() ?? true,
    }));
  }

  isAvailable(name: string): boolean {
    const provider = this.providers.get(name);
    return !!provider && (provider.isConfigured?.() ?? true);
  }

  resolve(name: string): PaymentGatewayProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`No payment gateway registered for provider "${name}"`);
    }
    return provider;
  }
}
