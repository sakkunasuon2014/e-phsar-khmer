import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient, DbExecutor } from '../db/drizzle.provider';
import { billingAddresses } from '../db/schema/billing-addresses.schema';
import type { BillingAddressRow } from '../db/schema/billing-addresses.schema';
import type {
  CreateBillingAddressDto,
  UpdateBillingAddressDto,
} from './dto/billing-address.dto';

function columns(dto: CreateBillingAddressDto, userId: string) {
  return {
    userId,
    label: dto.label,
    category: dto.category,
    name: dto.name,
    company: dto.company ?? null,
    email: dto.email ?? null,
    phone: dto.phone,
    address: dto.address,
    provinceId: dto.provinceId ?? null,
    districtId: dto.districtId ?? null,
    communeId: dto.communeId ?? null,
    // Drizzle's `numeric` round-trips as a string.
    latitude: dto.latitude === undefined ? null : String(dto.latitude),
    longitude: dto.longitude === undefined ? null : String(dto.longitude),
    taxId: dto.taxId ?? null,
    isDefault: dto.isDefault ?? false,
  };
}

/**
 * Saved billing addresses.
 *
 * One invariant holds after every mutation: **an account with addresses always
 * has exactly one default**. The database also enforces the upper bound (a
 * partial unique index on `is_default`), but the lower bound is the service's
 * job — `ensureDefault` promotes the newest row whenever a write would
 * otherwise leave none. That way the checkout never has to guess.
 */
@Injectable()
export class BillingAddressesService {
  constructor(@Inject(DRIZZLE) private readonly db: DbClient) {}

  async list(userId: string): Promise<BillingAddressRow[]> {
    return this.db
      .select()
      .from(billingAddresses)
      .where(eq(billingAddresses.userId, userId))
      .orderBy(
        desc(billingAddresses.isDefault),
        desc(billingAddresses.createdAt),
      );
  }

  async create(
    userId: string,
    dto: CreateBillingAddressDto,
  ): Promise<BillingAddressRow> {
    return this.db.transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(userId, tx);
      const [inserted] = await tx
        .insert(billingAddresses)
        .values(columns(dto, userId))
        .returning();
      // `ensureDefault` may have flipped this very row (the account's first
      // address becomes the default regardless of the request), so return the
      // row as it now stands rather than the insert's echo.
      await this.ensureDefault(userId, tx);
      const [row] = await tx
        .select()
        .from(billingAddresses)
        .where(eq(billingAddresses.id, inserted.id))
        .limit(1);
      return row;
    });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateBillingAddressDto,
  ): Promise<BillingAddressRow> {
    await this.findOwned(userId, id);
    return this.db.transaction(async (tx) => {
      const patch: Partial<typeof billingAddresses.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (dto.label !== undefined) patch.label = dto.label;
      if (dto.category !== undefined) patch.category = dto.category;
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.company !== undefined) patch.company = dto.company || null;
      if (dto.email !== undefined) patch.email = dto.email || null;
      if (dto.phone !== undefined) patch.phone = dto.phone;
      if (dto.address !== undefined) patch.address = dto.address;
      if (dto.provinceId !== undefined)
        patch.provinceId = dto.provinceId || null;
      if (dto.districtId !== undefined)
        patch.districtId = dto.districtId || null;
      if (dto.communeId !== undefined) patch.communeId = dto.communeId || null;
      if (dto.latitude !== undefined)
        patch.latitude = dto.latitude === null ? null : String(dto.latitude);
      if (dto.longitude !== undefined)
        patch.longitude = dto.longitude === null ? null : String(dto.longitude);
      if (dto.taxId !== undefined) patch.taxId = dto.taxId || null;
      if (dto.isDefault !== undefined) patch.isDefault = dto.isDefault;

      if (dto.isDefault) await this.clearDefault(userId, tx, id);
      await tx
        .update(billingAddresses)
        .set(patch)
        .where(
          and(eq(billingAddresses.id, id), eq(billingAddresses.userId, userId)),
        );
      await this.ensureDefault(userId, tx);

      const [row] = await tx
        .select()
        .from(billingAddresses)
        .where(eq(billingAddresses.id, id))
        .limit(1);
      return row;
    });
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    await this.findOwned(userId, id);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(billingAddresses)
        .where(
          and(eq(billingAddresses.id, id), eq(billingAddresses.userId, userId)),
        );
      await this.ensureDefault(userId, tx);
    });
    return { deleted: true };
  }

  private async findOwned(
    userId: string,
    id: string,
  ): Promise<BillingAddressRow> {
    const [row] = await this.db
      .select()
      .from(billingAddresses)
      .where(
        and(eq(billingAddresses.id, id), eq(billingAddresses.userId, userId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Billing address not found');
    return row;
  }

  /** Drops the account's current default so a new one can take the flag. */
  private async clearDefault(
    userId: string,
    tx: DbExecutor,
    exceptId?: string,
  ): Promise<void> {
    await tx
      .update(billingAddresses)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(billingAddresses.userId, userId),
          eq(billingAddresses.isDefault, true),
          ...(exceptId ? [ne(billingAddresses.id, exceptId)] : []),
        ),
      );
  }

  /** An account with addresses always has a default: promote the newest. */
  private async ensureDefault(userId: string, tx: DbExecutor): Promise<void> {
    const [current] = await tx
      .select({ id: billingAddresses.id })
      .from(billingAddresses)
      .where(
        and(
          eq(billingAddresses.userId, userId),
          eq(billingAddresses.isDefault, true),
        ),
      )
      .limit(1);
    if (current) return;

    const [newest] = await tx
      .select({ id: billingAddresses.id })
      .from(billingAddresses)
      .where(eq(billingAddresses.userId, userId))
      .orderBy(desc(billingAddresses.createdAt))
      .limit(1);
    if (!newest) return;

    await tx
      .update(billingAddresses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(billingAddresses.id, newest.id));
  }
}
