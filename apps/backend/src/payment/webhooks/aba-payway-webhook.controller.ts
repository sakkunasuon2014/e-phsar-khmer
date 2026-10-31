import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaymentEffectRunner } from '../payment-effect-runner.service';
import {
  findPaymentAttemptByProviderAttemptId,
  receivePaymentProviderEvent,
} from '../use-cases';
import { AbaPaywayProvider } from '../providers/aba-payway/aba-payway.provider';

/**
 * ABA PayWay's callback intake (`return_url` = `ABA_PAYWAY_WEBHOOK_URL`).
 * Verify the signature, then store the event and enqueue it — nothing is
 * written for a bad callback.
 *
 * Route: POST /api/v1/payments/webhooks/aba-payway
 *
 * Legacy alias `webhooks/aba-payway`: ABA gets the callback URL per
 * transaction, so checkouts created before the move still call the old path.
 * Drop it once none are unresolved (the reconciler covers a missed callback).
 */
@ApiTags('webhooks')
@Controller(['payments/webhooks/aba-payway', 'webhooks/aba-payway'])
export class AbaPaywayWebhookController {
  private readonly logger = new Logger(AbaPaywayWebhookController.name);

  constructor(
    private readonly effectRunner: PaymentEffectRunner,
    private readonly provider: AbaPaywayProvider,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Receive ABA PayWay's payment notification (401 on a bad " +
      'X-PayWay-Hmac-Sha512 signature, before any write)',
  })
  async webhook(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    const rawBody = JSON.stringify(body);
    const verification = this.provider.verifyWebhookSignature(rawBody, headers);
    if (!verification.valid) {
      this.logger.warn(
        `Rejected ABA PayWay webhook: ${verification.reason ?? 'invalid signature'}`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Signed but unusable (no tran_id): a 400, not a 500.
    let parsed: ReturnType<AbaPaywayProvider['parseWebhookEvent']>;
    try {
      parsed = this.provider.parseWebhookEvent(rawBody);
    } catch (error) {
      this.logger.warn(
        `Unusable ABA PayWay webhook: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('Malformed ABA PayWay callback');
    }
    const providerName = this.provider.name;

    // Correlation is a plain read; it needs no transaction.
    const attempt = parsed.providerAttemptId
      ? await this.effectRunner.run(
          findPaymentAttemptByProviderAttemptId({
            provider: providerName,
            providerAttemptId: parsed.providerAttemptId,
          }),
        )
      : undefined;

    await this.effectRunner.runDurably((outbox) =>
      receivePaymentProviderEvent(outbox, {
        provider: providerName,
        providerEventId: parsed.providerEventId,
        eventType: parsed.eventType,
        payload: body,
        paymentAttemptId: attempt?.id,
      }),
    );

    // ABA retries on a non-zero `code` in the body, not just on HTTP status.
    return { code: 0, message: 'Received' };
  }
}
