import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PaymentEffectRunner } from './payment-effect-runner.service';
import { PaymentGatewayRegistry } from './providers';
import { PaymentOnDemandReconciler } from './reconciler/payment-on-demand-reconciler.service';
import {
  checkOwnedPaymentTransaction,
  createPaymentTransaction,
  listOwnedPaymentAttempts,
  listPayments,
  upsertPayment,
} from './use-cases';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

/**
 * Every route here does exactly one thing: adapt its DTO/params into a
 * use-case's input shape, hand it to `PaymentEffectRunner`, return the
 * `Promise<T>` that comes back. All business logic — including composing
 * several primitives together, and the owner-only guard on `check`/
 * `listAttempts` — lives in the use-case itself (`use-cases/payments/`),
 * not in a service layer sitting between this controller and it.
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly effectRunner: PaymentEffectRunner,
    private readonly gateways: PaymentGatewayRegistry,
    private readonly onDemand: PaymentOnDemandReconciler,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a payment transaction and its first attempt, then durably ' +
      'hand it off for processing — the full lifecycle up to (not ' +
      'including) the queue processor calling the provider',
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePaymentDto) {
    return this.effectRunner.runDurably((outbox) =>
      createPaymentTransaction(outbox, {
        reference: dto.reference,
        idempotencyKey: dto.idempotencyKey,
        amount: dto.amount.toString(),
        currency: dto.currency,
        customerId: user.id,
        orderId: dto.orderId,
        description: dto.description,
        provider: dto.provider,
        method: dto.method,
        browserReturnUrl: dto.browserReturnUrl,
        browserCancelUrl: dto.browserCancelUrl,
      }),
    );
  }

  @Get()
  @ApiOperation({ summary: "List the current user's payment transactions" })
  list(@CurrentUser() user: RequestUser, @Query() query: ListPaymentsQueryDto) {
    return this.effectRunner.run(
      listPayments({
        customerId: user.id,
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }

  // Declared before `:id` so Express doesn't route "providers" as an id.
  // Reads in-memory registry state only — no use-case, nothing to run.
  @Get('providers')
  @ApiOperation({
    summary:
      'List the registered payment providers for a checkout picker. ' +
      '`available: false` means the provider is registered but missing ' +
      'credentials — show it, but do not let the payer pick it.',
  })
  providers() {
    return this.gateways.list();
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Check a payment transaction by id (owner only). `checkout` carries ' +
      "the gateway's checkout artifact (QR string, redirect URL, raw " +
      'response) once charge() has produced one, and is `null` until then ' +
      '— charge() runs asynchronously via the outbox/queue, so a client ' +
      'that just POSTed should poll this endpoint rather than expect the ' +
      'artifact in the creation response itself.',
  })
  async check(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    // The owner check runs first and is the only authorization: a non-owner
    // gets the same 404 as a missing id and never reaches the provider call.
    const read = () =>
      this.effectRunner.run(
        checkOwnedPaymentTransaction({ id, customerId: user.id }),
      );
    const transaction = await read();

    // While a checkout is open, let this read nudge a settle along (at most
    // one provider call per attempt per 5 s). The answer still comes from the
    // database; re-read only if the check actually resolved something.
    if (
      transaction.status !== 'pending' &&
      transaction.status !== 'processing'
    ) {
      return transaction;
    }
    const refreshed = await this.onDemand.refresh(transaction.id);
    return refreshed === 'changed' ? read() : transaction;
  }

  @Get(':id/attempts')
  @ApiOperation({
    summary: "List a payment transaction's attempts (owner only)",
  })
  listAttempts(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.effectRunner.run(
      listOwnedPaymentAttempts({
        paymentTransactionId: id,
        customerId: user.id,
      }),
    );
  }

  @Patch(':id')
  @Roles('admin')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary:
      'Update a payment transaction (optimistic-locked on version). ' +
      'Admin-only: status transitions are a system/webhook/admin concern ' +
      '(see payment_status_history.actorType) — never customer-initiated.',
  })
  update(@Param('id') id: string, @Body() dto: UpdatePaymentDto) {
    // Every purchase is final — there is no refund path, not even for admins.
    if (dto.status === 'refund_pending' || dto.status === 'refunded') {
      throw new BadRequestException('Refunds are not supported');
    }
    return this.effectRunner.run(
      upsertPayment({
        id,
        expectedVersion: dto.expectedVersion,
        status: dto.status,
        description: dto.description,
      }),
    );
  }
}
