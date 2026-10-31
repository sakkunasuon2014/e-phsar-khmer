import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PAYMENT_PROVIDER_NAMES,
  type PaymentProviderName,
} from '../../payment/providers';

export class CreateSubscriptionCheckoutDto {
  @IsUUID()
  termId: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  idempotencyKey: string;

  // The payer's pick from GET /payments/providers. Defaults to Bakong, the
  // only provider before the picker existed.
  @IsOptional()
  @IsIn(PAYMENT_PROVIDER_NAMES)
  provider?: PaymentProviderName;

  @IsOptional()
  @IsIn(['bank'])
  method?: 'bank';
}
