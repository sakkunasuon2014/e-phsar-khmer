import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
} from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import {
  buildUsernameBase,
  generateUniqueUsername,
  normalizeUsername,
} from './username.util';
import { randomUUID } from 'node:crypto';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient, DbExecutor } from '../db/drizzle.provider';
import { listings } from '../db/schema/listings.schema';
import {
  communes,
  districts,
  userAuthProviders,
  userBlocks,
  userFollows,
  userPhones,
  users,
} from '../db/schema/users.schema';
import type { UserRow, UserPhoneRow } from '../db/schema/users.schema';
import { SupabaseService } from '../common/supabase/supabase.service';
import { FilesService } from '../files/files.service';
import { isPhoneBanned } from '../reports/phone-ban.util';
import { ConfigService } from '@nestjs/config';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { AddPhoneDto } from './dto/add-phone.dto';
import type { UpdatePhoneDto } from './dto/update-phone.dto';
import type { BlockUserDto } from './dto/block-user.dto';
import type { ChangeUsernameDto } from './dto/change-username.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { DeleteAccountDto } from './dto/delete-account.dto';
import type { RequestPhoneChangeDto } from './dto/request-phone-change.dto';
import type { VerifyPhoneChangeDto } from './dto/verify-phone-change.dto';
import type { ListFollowsDto } from './dto/list-follows.dto';
import type { PaginatedResponse } from '../common/types/api-response.types';
import { isBlockedEitherWay } from '../chat/blocks.util';
import { NotificationsService } from '../notifications/notifications.service';
import { hasActivePaidSubscription } from '../subscriptions/verified-account.util';
import type { PublicUser } from '../auth/auth.service';

/** Matches AuthService/AdminService — bcrypt cost is a property of the data, not the caller. */
const BCRYPT_ROUNDS = 10;

export interface BlockedUserItem {
  id: string;
  blockedUser: {
    id: string;
    username: string | null;
    profilePhotoUrl: string | null;
  } | null;
  createdAt: Date;
}

/** Public identity of one user in a followers/following list. */
export interface FollowUserItem {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePhotoUrl: string | null;
  /** Whether the requesting viewer already follows this row. */
  isFollowing: boolean;
}

/**
 * Everything the public profile page renders. Deliberately an explicit
 * allow-list rather than `PublicUser`: this shape is served to anonymous
 * callers, so phone, email, role, status and moderation fields must never be
 * part of it — the same over-exposure `GET /users/:id` is already flagged for.
 */
export interface PublicProfile {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePhotoUrl: string | null;
  coverPhotoUrl: string | null;
  isVerified: boolean;
  /** At least one current, unexpired paid subscription — the "Verified Account" badge. */
  verifiedAccount: boolean;
  createdAt: Date;
  followers: number;
  following: number;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly filesService: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async findById(
    id: string,
    includeAuthProviders = false,
  ): Promise<
    PublicUser & {
      verifiedAccount: boolean;
      authProviders?: ('google' | 'facebook' | 'telegram')[];
    }
  > {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new NotFoundException('User not found');

    const result = {
      ...this.toPublicUser(user),
      verifiedAccount: await hasActivePaidSubscription(this.db, id),
    };
    if (!includeAuthProviders) return result;

    // Opt-in on purpose: the (user) layout reads /users/me on every page, and
    // only the settings surface needs the linked-provider list.
    const rows = await this.db
      .select({ provider: userAuthProviders.provider })
      .from(userAuthProviders)
      .where(
        and(
          eq(userAuthProviders.userId, id),
          inArray(userAuthProviders.provider, [
            'google',
            'facebook',
            'telegram',
          ]),
          isNotNull(userAuthProviders.providerAccountId),
        ),
      );

    const order = ['google', 'facebook', 'telegram'] as const;
    return {
      ...result,
      authProviders: order.filter((provider) =>
        rows.some((row) => row.provider === provider),
      ),
    };
  }

  async findByUsernameOrPhone(identifier: string): Promise<UserRow | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, identifier), isNull(users.deletedAt)))
      .limit(1);
    if (user) return user;

    const [byPhone] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.primaryPhone, identifier), isNull(users.deletedAt)))
      .limit(1);
    return byPhone ?? null;
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const hasLocationChange =
      dto.provinceId !== undefined ||
      dto.districtId !== undefined ||
      dto.communeId !== undefined;
    const hasNameChange =
      dto.firstName !== undefined || dto.lastName !== undefined;

    let currentUser: UserRow | undefined;

    if (hasLocationChange || hasNameChange) {
      [currentUser] = await this.db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!currentUser) throw new NotFoundException('User not found');
    }

    if (hasLocationChange) {
      await this.validateLocationHierarchy(currentUser!, dto);
    }

    const updateData: Partial<UserRow> = {};

    if (dto.firstName !== undefined) updateData.firstName = dto.firstName;
    if (dto.lastName !== undefined) updateData.lastName = dto.lastName;
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.yearOfBirth !== undefined) updateData.yearOfBirth = dto.yearOfBirth;
    // The full birthday is authoritative when sent; the legacy year column is
    // derived from it so the two representations cannot disagree.
    if (dto.dateOfBirth !== undefined) {
      if (dto.dateOfBirth === null) {
        updateData.dateOfBirth = null;
        updateData.yearOfBirth = null;
      } else {
        if (new Date(dto.dateOfBirth) > new Date())
          throw new BadRequestException('INVALID_DATE_OF_BIRTH');
        updateData.dateOfBirth = dto.dateOfBirth;
        updateData.yearOfBirth = Number(dto.dateOfBirth.slice(0, 4));
      }
    }
    if (dto.company !== undefined) updateData.company = dto.company;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.provinceId !== undefined) updateData.provinceId = dto.provinceId;
    if (dto.districtId !== undefined) updateData.districtId = dto.districtId;
    if (dto.communeId !== undefined) updateData.communeId = dto.communeId;
    if (dto.address !== undefined) updateData.address = dto.address;
    // null clears the pin; `String(null)` would write the literal "null" and
    // fail the numeric column.
    if (dto.latitude !== undefined)
      updateData.latitude = dto.latitude != null ? String(dto.latitude) : null;
    if (dto.longitude !== undefined)
      updateData.longitude =
        dto.longitude != null ? String(dto.longitude) : null;
    if (dto.preferredLanguage !== undefined)
      updateData.preferredLanguage = dto.preferredLanguage;
    // Privacy toggles are independent: only the keys this PATCH carried are
    // written, so flipping "Email" cannot clobber a concurrent "Phone" change.
    if (dto.discoverableByGender !== undefined)
      updateData.discoverableByGender = dto.discoverableByGender;
    if (dto.discoverableByDateOfBirth !== undefined)
      updateData.discoverableByDateOfBirth = dto.discoverableByDateOfBirth;
    if (dto.discoverableByPhone !== undefined)
      updateData.discoverableByPhone = dto.discoverableByPhone;
    if (dto.discoverableByEmail !== undefined)
      updateData.discoverableByEmail = dto.discoverableByEmail;
    if (dto.discoverableByLocation !== undefined)
      updateData.discoverableByLocation = dto.discoverableByLocation;

    if (hasNameChange && currentUser && currentUser.username === null) {
      const effFirst = dto.firstName ?? currentUser.firstName;
      const effLast = dto.lastName ?? currentUser.lastName;
      const base = buildUsernameBase(effFirst, effLast);
      if (base !== null) {
        updateData.username = await generateUniqueUsername(this.db, base);
      }
    }

    updateData.updatedAt = new Date();

    try {
      // One transaction so "Update this contact to your ads" can never leave
      // the profile saved but the listings half-rewritten.
      const updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(users)
          .set(updateData)
          .where(eq(users.id, userId))
          .returning();

        if (!row) throw new NotFoundException('User not found');
        if (dto.updateAdsContact) await this.copyContactToAds(tx, row);
        return row;
      });

      return this.toPublicUser(updated);
    } catch (err) {
      // The settings form edits `email`, which is unique among active users —
      // without this the duplicate arrives as a raw 23505 → 500.
      if (this.isUniqueViolation(err, 'users_email_active_uq')) {
        throw new ConflictException('EMAIL_TAKEN');
      }
      if (this.isUniqueViolation(err, 'users_username_active_uq')) {
        throw new ConflictException('USERNAME_TAKEN');
      }
      throw err;
    }
  }

  /**
   * "Update this contact to your ads": copy the profile's contact block and
   * location onto every non-deleted listing the user owns. Ticking the box is
   * the user saying "make my ads match my profile", and the settings form
   * requires phone, location and address while it is ticked. The map pin only
   * travels when the profile has one — an account that never dropped a pin
   * must not wipe the pin an individual ad already carries.
   */
  private async copyContactToAds(tx: DbExecutor, user: UserRow): Promise<void> {
    const phoneRows = await tx
      .select({ phone: userPhones.phone, isPrimary: userPhones.isPrimary })
      .from(userPhones)
      .where(eq(userPhones.userId, user.id));

    // Primary first, then the rest; the listing contact block caps at 3.
    const phones = [
      ...phoneRows.filter((p) => p.isPrimary),
      ...phoneRows.filter((p) => !p.isPrimary),
    ]
      .map((p) => p.phone)
      .slice(0, 3);
    // An account can have a primaryPhone but no user_phones row (the known
    // soft-delete gap) — never blank a listing's phones in that case.
    if (phones.length === 0 && user.primaryPhone)
      phones.push(user.primaryPhone);

    const contactName =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      user.username ||
      null;

    // A pin on the profile overwrites the ad's; no pin leaves the ad's alone.
    const pin =
      user.latitude !== null && user.longitude !== null
        ? { latitude: user.latitude, longitude: user.longitude }
        : {};

    await tx
      .update(listings)
      .set({
        contactName,
        contactPhones: phones,
        contactEmail: user.email,
        provinceId: user.provinceId,
        districtId: user.districtId,
        communeId: user.communeId,
        address: user.address,
        ...pin,
        updatedAt: new Date(),
      })
      .where(and(eq(listings.userId, user.id), ne(listings.status, 'deleted')));
  }

  async listPhones(userId: string): Promise<UserPhoneRow[]> {
    return this.db
      .select()
      .from(userPhones)
      .where(eq(userPhones.userId, userId));
  }

  async addPhone(userId: string, dto: AddPhoneDto): Promise<UserPhoneRow> {
    await this.assertPhoneNotBanned(dto.phone);

    try {
      return await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(userPhones)
          .where(eq(userPhones.phone, dto.phone))
          .limit(1);
        if (existing) throw new ConflictException('Phone already in use');

        const [hasAny] = await tx
          .select({ id: userPhones.id })
          .from(userPhones)
          .where(eq(userPhones.userId, userId))
          .limit(1);
        const makePrimary = dto.isPrimary ?? !hasAny;

        if (makePrimary) {
          await tx
            .update(userPhones)
            .set({ isPrimary: false })
            .where(eq(userPhones.userId, userId));
        }

        const [created] = await tx
          .insert(userPhones)
          .values({ userId, phone: dto.phone, isPrimary: makePrimary })
          .returning();

        if (makePrimary) {
          // Same rule as setPrimaryPhone: the primary row and the login
          // identifier must never disagree.
          await tx
            .update(users)
            .set({ primaryPhone: dto.phone, updatedAt: new Date() })
            .where(eq(users.id, userId));
        }
        return created;
      });
    } catch (err) {
      // The check above is not atomic with the insert: a concurrent add of
      // the same number (or of a second primary) lands here as 23505.
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: unknown }).code === '23505'
      ) {
        throw new ConflictException('Phone already in use');
      }
      throw err;
    }
  }

  /**
  /**
   * Edits one saved contact number in place. Deliberately does NOT touch
   * `users.primaryPhone`: the active (login) phone is a separate concept from
   * the contact numbers shown on ads, and only the OTP-gated change-phone
   * flow may move it.
   */
  async updatePhone(
    userId: string,
    phoneId: string,
    dto: UpdatePhoneDto,
  ): Promise<UserPhoneRow> {
    await this.assertPhoneNotBanned(dto.phone);

    const [existing] = await this.db
      .select()
      .from(userPhones)
      .where(and(eq(userPhones.id, phoneId), eq(userPhones.userId, userId)))
      .limit(1);
    if (!existing) throw new NotFoundException('Phone not found');
    if (existing.phone === dto.phone) return existing;

    const [owner] = await this.db
      .select({ id: userPhones.id })
      .from(userPhones)
      .where(eq(userPhones.phone, dto.phone))
      .limit(1);
    if (owner) throw new ConflictException('Phone already in use');

    const [updated] = await this.db
      .update(userPhones)
      .set({ phone: dto.phone })
      .where(and(eq(userPhones.id, phoneId), eq(userPhones.userId, userId)))
      .returning();
    return updated;
  }

  /**
   * Removing the primary promotes another phone (and moves the login
   * identifier with it); removing the only phone is refused, since for a
   * phone-registered account it is the way they sign in.
   */
  async removePhone(
    userId: string,
    phoneId: string,
  ): Promise<{ removed: true }> {
    return this.db.transaction(async (tx) => {
      const phones = await tx
        .select()
        .from(userPhones)
        .where(eq(userPhones.userId, userId))
        .for('update');
      const target = phones.find((p) => p.id === phoneId);
      if (!target) throw new NotFoundException('Phone not found');
      if (phones.length === 1) {
        throw new BadRequestException('CANNOT_REMOVE_LAST_PHONE');
      }

      await tx
        .delete(userPhones)
        .where(and(eq(userPhones.id, phoneId), eq(userPhones.userId, userId)));

      if (target.isPrimary) {
        const next = phones.find((p) => p.id !== phoneId)!;
        await tx
          .update(userPhones)
          .set({ isPrimary: true })
          .where(eq(userPhones.id, next.id));
        await tx
          .update(users)
          .set({ primaryPhone: next.phone, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
      return { removed: true as const };
    });
  }

  async setPrimaryPhone(
    userId: string,
    phoneId: string,
  ): Promise<UserPhoneRow> {
    const [target] = await this.db
      .select()
      .from(userPhones)
      .where(and(eq(userPhones.id, phoneId), eq(userPhones.userId, userId)))
      .limit(1);
    if (!target) throw new NotFoundException('Phone not found');

    return this.db.transaction(async (tx) => {
      await tx
        .update(userPhones)
        .set({ isPrimary: false })
        .where(eq(userPhones.userId, userId));

      const [updated] = await tx
        .update(userPhones)
        .set({ isPrimary: true })
        .where(eq(userPhones.id, phoneId))
        .returning();

      // `users.primaryPhone` is the login identifier (login and both OTP
      // flows look the user up by it), so a primary row that disagrees with
      // it locks the user out of the number their settings page shows.
      await tx
        .update(users)
        .set({ primaryPhone: target.phone, updatedAt: new Date() })
        .where(eq(users.id, userId));

      return updated;
    });
  }

  /**
   * Self-service username change. The probe deliberately covers every row,
   * soft-deleted ones included — the same stricter-than-the-index rule
   * `generateUniqueUsername` follows, so a handle can't be taken from an
   * account that is 90 days away from being purged.
   */
  async changeUsername(
    userId: string,
    dto: ChangeUsernameDto,
  ): Promise<PublicUser> {
    const candidate = normalizeUsername(dto.username);

    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate))
      .limit(1);
    if (taken && taken.id !== userId) {
      throw new ConflictException('USERNAME_TAKEN');
    }

    try {
      const [updated] = await this.db
        .update(users)
        .set({ username: candidate, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) throw new NotFoundException('User not found');
      return this.toPublicUser(updated);
    } catch (err) {
      // The probe above is check-then-write; the partial unique index is the
      // truth when two people pick the same handle at once.
      if (this.isUniqueViolation(err, 'users_username_active_uq')) {
        throw new ConflictException('USERNAME_TAKEN');
      }
      throw err;
    }
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ updated: true }> {
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new NotFoundException('User not found');
    if (!user.passwordHash) throw new BadRequestException('PASSWORD_NOT_SET');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    // 400 rather than 401 on purpose: userServerFetch reads a 401 as an
    // expired session and clears the cookies, which would sign the user out
    // of the very page they mistyped their password on.
    if (!valid) throw new BadRequestException('INVALID_PASSWORD');

    await this.db
      .update(users)
      .set({
        passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { updated: true };
  }

  async requestPhoneChangeOtp(
    userId: string,
    dto: RequestPhoneChangeDto,
  ): Promise<{ otpSent: true }> {
    await this.assertPhoneAvailable(userId, dto.phone);
    await this.supabaseService.signInWithOtp(dto.phone);
    return { otpSent: true };
  }

  /**
   * Verifies a new active phone. Deliberately not routed through
   * `AuthService.verifyPhoneOtp` — that is the login/registration chokepoint
   * and would create a brand-new account for a number it doesn't recognise.
   */
  async verifyPhoneChangeOtp(
    userId: string,
    dto: VerifyPhoneChangeDto,
  ): Promise<PublicUser> {
    const { data, error } = await this.supabaseService.verifyOtp(
      dto.phone,
      dto.token,
    );
    if (error || !data.user) throw new BadRequestException('INVALID_OTP');

    // Re-checked after the OTP round trip: another account can claim the
    // number while this one is typing the code.
    await this.assertPhoneAvailable(userId, dto.phone);

    try {
      await this.db.transaction(async (tx) => {
        const [primary] = await tx
          .select({ id: userPhones.id })
          .from(userPhones)
          .where(
            and(eq(userPhones.userId, userId), eq(userPhones.isPrimary, true)),
          )
          .limit(1);

        // Updated in place rather than added alongside: `user_phones.phone`
        // is globally unique forever, so keeping the old row would reserve a
        // number this user no longer owns.
        if (primary) {
          await tx
            .update(userPhones)
            .set({ phone: dto.phone })
            .where(eq(userPhones.id, primary.id));
        } else {
          await tx
            .insert(userPhones)
            .values({ userId, phone: dto.phone, isPrimary: true });
        }

        await tx
          .update(users)
          .set({
            primaryPhone: dto.phone,
            phoneVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        await tx
          .insert(userAuthProviders)
          .values({ userId, provider: 'phone' })
          .onConflictDoNothing({
            target: [userAuthProviders.userId, userAuthProviders.provider],
          });
      });
    } catch (err) {
      if (this.isUniqueViolation(err, 'user_phones_phone_unique')) {
        throw new ConflictException('PHONE_TAKEN');
      }
      throw err;
    }

    return this.findById(userId);
  }

  async deleteOwnAccount(
    userId: string,
    dto: DeleteAccountDto,
  ): Promise<{ deleted: true }> {
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new NotFoundException('User not found');
    if (!user.passwordHash) throw new BadRequestException('PASSWORD_NOT_SET');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new BadRequestException('INVALID_PASSWORD');

    // Keeps `primaryPhone` and the user_phones rows on purpose, unlike
    // AdminService.deleteUser which nulls them: those identifiers are what
    // AuthService's reactivation window matches on, and their presence is
    // what separates a self-deletion from an admin one. Removing the account
    // for good is AccountPurgeService's job, 90 days out.
    await this.db
      .update(users)
      .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));

    return { deleted: true };
  }

  /**
   * A phone belongs to exactly one account: as a login identifier
   * (`users.primaryPhone`) and as a globally unique `user_phones` row.
   */
  private async assertPhoneAvailable(
    userId: string,
    phone: string,
  ): Promise<void> {
    // A moderation-banned number can never be added to (or swapped into) an
    // account — otherwise the ban is one free Telegram/social account away
    // from bypass.
    await this.assertPhoneNotBanned(phone);

    const [owner] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.primaryPhone, phone), isNull(users.deletedAt)))
      .limit(1);
    if (owner) {
      throw new ConflictException(
        owner.id === userId ? 'PHONE_UNCHANGED' : 'PHONE_TAKEN',
      );
    }

    const [row] = await this.db
      .select({ userId: userPhones.userId })
      .from(userPhones)
      .where(eq(userPhones.phone, phone))
      .limit(1);
    if (row && row.userId !== userId) {
      throw new ConflictException('PHONE_TAKEN');
    }
  }

  private async assertPhoneNotBanned(phone: string): Promise<void> {
    if (await isPhoneBanned(this.db, phone)) {
      throw new ForbiddenException({
        code: 'PHONE_BANNED',
        message: 'This phone number has been banned.',
      });
    }
  }

  private isUniqueViolation(err: unknown, constraint: string): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: unknown; constraint_name?: unknown };
    return e.code === '23505' && e.constraint_name === constraint;
  }

  async blockUser(
    userId: string,
    dto: BlockUserDto,
  ): Promise<{ blocked: true }> {
    if (dto.userId === userId)
      throw new BadRequestException('Cannot block yourself');

    const [target] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, dto.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!target) throw new NotFoundException('User not found');

    await this.db
      .insert(userBlocks)
      .values({ blockerId: userId, blockedId: dto.userId })
      .onConflictDoNothing({
        target: [userBlocks.blockerId, userBlocks.blockedId],
      });
    return { blocked: true };
  }

  async unblockUser(
    userId: string,
    blockedId: string,
  ): Promise<{ removed: true }> {
    const [deleted] = await this.db
      .delete(userBlocks)
      .where(
        and(
          eq(userBlocks.blockerId, userId),
          eq(userBlocks.blockedId, blockedId),
        ),
      )
      .returning();
    if (!deleted) throw new NotFoundException('Block not found');
    return { removed: true };
  }

  async listBlocks(userId: string): Promise<BlockedUserItem[]> {
    const blocks = await this.db
      .select()
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, userId))
      .orderBy(desc(userBlocks.createdAt));
    if (blocks.length === 0) return [];

    const profiles = await this.db
      .select({
        id: users.id,
        username: users.username,
        profilePhotoUrl: users.profilePhotoUrl,
      })
      .from(users)
      .where(
        inArray(
          users.id,
          blocks.map((b) => b.blockedId),
        ),
      );
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    return blocks.map((b) => ({
      id: b.id,
      blockedUser: profileMap.get(b.blockedId) ?? null,
      createdAt: b.createdAt,
    }));
  }

  /**
   * Follow a user. Idempotent: re-following is a silent no-op, so a double-tap
   * or a replayed request can never create a second edge. The `returning()` row
   * is what gates the notification — a replay must not notify twice.
   */
  async followUser(
    followerId: string,
    followingId: string,
  ): Promise<{ following: true }> {
    if (followingId === followerId)
      throw new BadRequestException('Cannot follow yourself');

    const [target] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, followingId), isNull(users.deletedAt)))
      .limit(1);
    if (!target) throw new NotFoundException('User not found');

    // A block in either direction suppresses following both ways round — the
    // same bidirectional rule chat already applies to sends.
    if (await isBlockedEitherWay(this.db, followerId, followingId))
      throw new ForbiddenException('Following unavailable');

    const [inserted] = await this.db
      .insert(userFollows)
      .values({ followerId, followingId })
      .onConflictDoNothing({
        target: [userFollows.followerId, userFollows.followingId],
      })
      .returning({ id: userFollows.id });

    if (inserted) await this.notifyNewFollower(followerId, followingId);
    return { following: true };
  }

  /**
   * Unfollow. Unlike `unblockUser` this does NOT 404 when the edge is already
   * gone: the follow control is a toggle whose end state is the whole contract,
   * so a double-tap has to land on "not following" rather than an error toast.
   */
  async unfollowUser(
    followerId: string,
    followingId: string,
  ): Promise<{ following: false }> {
    await this.db
      .delete(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId),
        ),
      );
    return { following: false };
  }

  /**
   * Whether `viewerId` follows `targetId`. The viewer-relative bit the public
   * profile endpoint cannot answer: that one is anonymous, so it has no viewer.
   */
  async isFollowing(
    viewerId: string,
    targetId: string,
  ): Promise<{ following: boolean }> {
    const [row] = await this.db
      .select({ id: userFollows.id })
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerId, viewerId),
          eq(userFollows.followingId, targetId),
        ),
      )
      .limit(1);
    return { following: Boolean(row) };
  }

  /** Both profile-header counts in one round trip. */
  async getFollowCounts(
    userId: string,
  ): Promise<{ followers: number; following: number }> {
    const [[followers], [following]] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(userFollows)
        .where(eq(userFollows.followingId, userId)),
      this.db
        .select({ value: count() })
        .from(userFollows)
        .where(eq(userFollows.followerId, userId)),
    ]);
    return { followers: followers.value, following: following.value };
  }

  /** The public profile, looked up by handle. */
  async getPublicProfile(username: string): Promise<PublicProfile> {
    const [user] = await this.db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        profilePhotoUrl: users.profilePhotoUrl,
        coverPhotoUrl: users.coverPhotoUrl,
        phoneVerifiedAt: users.phoneVerifiedAt,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      // A moderation-suspended account is not publicly viewable: approving a
      // user report must take the profile down, not just block its login.
      .where(
        and(
          eq(users.username, username),
          isNull(users.deletedAt),
          eq(users.status, 'active'),
        ),
      )
      .limit(1);
    if (!user) throw new NotFoundException('User not found');

    const counts = await this.getFollowCounts(user.id);
    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePhotoUrl: user.profilePhotoUrl,
      coverPhotoUrl: user.coverPhotoUrl,
      isVerified: Boolean(user.phoneVerifiedAt || user.emailVerifiedAt),
      verifiedAccount: await hasActivePaidSubscription(this.db, user.id),
      createdAt: user.createdAt,
      ...counts,
    };
  }

  /** Who follows `targetId`, newest first. */
  async listFollowers(
    viewerId: string,
    targetId: string,
    query: ListFollowsDto,
  ): Promise<PaginatedResponse<FollowUserItem>> {
    return this.listFollowEdges(viewerId, targetId, query, 'followers');
  }

  /** Who `targetId` follows, newest first. */
  async listFollowing(
    viewerId: string,
    targetId: string,
    query: ListFollowsDto,
  ): Promise<PaginatedResponse<FollowUserItem>> {
    return this.listFollowEdges(viewerId, targetId, query, 'following');
  }

  /**
   * One page of either side of the follow graph.
   *
   * The two directions are the same query with the columns swapped: a follower
   * edge is stored pointing AT the target, so the person to show is the
   * *follower*; the following list is its mirror image.
   */
  private async listFollowEdges(
    viewerId: string,
    targetId: string,
    query: ListFollowsDto,
    side: 'followers' | 'following',
  ): Promise<PaginatedResponse<FollowUserItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const shownColumn =
      side === 'followers' ? userFollows.followerId : userFollows.followingId;
    const matchColumn =
      side === 'followers' ? userFollows.followingId : userFollows.followerId;
    const where = eq(matchColumn, targetId);

    const [edges, [totalRow]] = await Promise.all([
      this.db
        .select({ userId: shownColumn })
        .from(userFollows)
        .where(where)
        // `id` breaks ties so a page boundary can never repeat or skip a row
        // when several edges land on the same timestamp.
        .orderBy(desc(userFollows.createdAt), desc(userFollows.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ value: count() }).from(userFollows).where(where),
    ]);

    const total = totalRow.value;
    return {
      data: await this.hydrateFollowUsers(
        viewerId,
        edges.map((e) => e.userId),
      ),
      meta: {
        nextCursor: null,
        hasMore: offset + edges.length < total,
        limit: pageSize,
        total,
        page,
        pageSize,
      },
    };
  }

  /**
   * Turns a page of follow edges into renderable users, preserving edge order.
   * Two further queries rather than an N+1 — the batch-lookup pattern
   * `listBlocks` uses: one for the profiles, one for which of them the viewer
   * already follows (so every row can offer the right toggle state).
   *
   * A soft-deleted profile is dropped rather than rendered as a hole: an edge
   * can outlive its profile for up to the purge window. `meta.total` counts
   * edges, so a page can come back one short at the boundary — showing a
   * deleted account would be worse.
   */
  private async hydrateFollowUsers(
    viewerId: string,
    userIds: string[],
  ): Promise<FollowUserItem[]> {
    if (userIds.length === 0) return [];

    const [profiles, followed] = await Promise.all([
      this.db
        .select({
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          profilePhotoUrl: users.profilePhotoUrl,
        })
        .from(users)
        .where(and(inArray(users.id, userIds), isNull(users.deletedAt))),
      this.db
        .select({ id: userFollows.followingId })
        .from(userFollows)
        .where(
          and(
            eq(userFollows.followerId, viewerId),
            inArray(userFollows.followingId, userIds),
          ),
        ),
    ]);

    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const followedIds = new Set(followed.map((f) => f.id));

    const items: FollowUserItem[] = [];
    for (const id of userIds) {
      const profile = profileById.get(id);
      if (profile) items.push({ ...profile, isFollowing: followedIds.has(id) });
    }
    return items;
  }

  /**
   * Tell someone they gained a follower. Only ever called for a genuinely new
   * edge, so a replayed follow cannot double-notify.
   */
  private async notifyNewFollower(
    followerId: string,
    followingId: string,
  ): Promise<void> {
    const [follower] = await this.db
      .select({
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, followerId))
      .limit(1);

    const name =
      [follower?.firstName, follower?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      follower?.username ||
      'Someone';

    await this.notifications.notify({
      userId: followingId,
      type: 'follow.created',
      title: `${name} started following you`,
      data: { followerId, username: follower?.username ?? null },
    });
  }

  async setProfilePhoto(
    userId: string,
    file: Express.Multer.File,
  ): Promise<PublicUser> {
    this.validateImageFile(file);
    const bucket =
      this.configService.get<string>('supabase.storageBucket') ?? 'listings';
    const path = `avatar/${userId}/${randomUUID()}-${this.safeName(file.originalname)}`;

    const { error } = await this.supabaseService.uploadObject(
      bucket,
      path,
      file.buffer,
      file.mimetype,
    );
    if (error) throw new ForbiddenException('Failed to upload profile photo');

    const { data } = this.supabaseService.getPublicUrl(bucket, path);

    // Read the prior URL so the old avatar can be cleaned up after the swap.
    const [prior] = await this.db
      .select({ url: users.profilePhotoUrl })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [updated] = await this.db
      .update(users)
      .set({ profilePhotoUrl: data.publicUrl, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    // Best-effort cleanup — removeByPublicUrl warns on error, never throws.
    if (prior?.url && prior.url !== data.publicUrl) {
      await this.filesService.removeByPublicUrl(prior.url);
    }

    return this.toPublicUser(updated);
  }

  async setCoverPhoto(
    userId: string,
    file: Express.Multer.File,
  ): Promise<PublicUser> {
    this.validateImageFile(file);
    const bucket =
      this.configService.get<string>('supabase.storageBucket') ?? 'listings';
    const path = `cover/${userId}/${randomUUID()}-${this.safeName(file.originalname)}`;

    const { error } = await this.supabaseService.uploadObject(
      bucket,
      path,
      file.buffer,
      file.mimetype,
    );
    if (error) throw new ForbiddenException('Failed to upload cover photo');

    const { data } = this.supabaseService.getPublicUrl(bucket, path);

    // Read the prior URL so the old cover can be cleaned up after the swap.
    const [prior] = await this.db
      .select({ url: users.coverPhotoUrl })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [updated] = await this.db
      .update(users)
      .set({ coverPhotoUrl: data.publicUrl, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    // Best-effort cleanup — removeByPublicUrl warns on error, never throws.
    if (prior?.url && prior.url !== data.publicUrl) {
      await this.filesService.removeByPublicUrl(prior.url);
    }

    return this.toPublicUser(updated);
  }

  private async validateLocationHierarchy(
    currentUser: UserRow,
    dto: UpdateProfileDto,
  ): Promise<void> {
    // `undefined` means "leave alone" and `null` means "clear", so the
    // fallback has to be an explicit undefined check — `??` would turn a
    // deliberate null back into the stored value.
    const effectiveProvinceId =
      dto.provinceId !== undefined ? dto.provinceId : currentUser.provinceId;
    const effectiveDistrictId =
      dto.districtId !== undefined ? dto.districtId : currentUser.districtId;
    const effectiveCommuneId =
      dto.communeId !== undefined ? dto.communeId : currentUser.communeId;

    // Clearing a parent while keeping its child would leave a row no province
    // filter could ever reach, so only the *clearing* is refused. A row that
    // already carries a child without a parent (the columns are independent)
    // is left exactly as it is.
    if (
      (dto.provinceId === null && effectiveDistrictId) ||
      (dto.districtId === null && effectiveCommuneId)
    ) {
      throw new BadRequestException('INVALID_LOCATION_HIERARCHY');
    }

    if (
      effectiveDistrictId &&
      effectiveProvinceId &&
      (dto.districtId !== undefined || dto.provinceId !== undefined)
    ) {
      const [d] = await this.db
        .select({ provinceId: districts.provinceId })
        .from(districts)
        .where(eq(districts.id, effectiveDistrictId))
        .limit(1);
      if (!d || d.provinceId !== effectiveProvinceId) {
        throw new BadRequestException('INVALID_LOCATION_HIERARCHY');
      }
    }

    if (
      effectiveCommuneId &&
      effectiveDistrictId &&
      (dto.communeId !== undefined || dto.districtId !== undefined)
    ) {
      const [c] = await this.db
        .select({ districtId: communes.districtId })
        .from(communes)
        .where(eq(communes.id, effectiveCommuneId))
        .limit(1);
      if (!c || c.districtId !== effectiveDistrictId) {
        throw new BadRequestException('INVALID_LOCATION_HIERARCHY');
      }
    }
  }

  private validateImageFile(file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('A file is required');
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype)) {
      throw new BadRequestException('Only image files are allowed');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size must not exceed 5MB');
    }
  }

  private safeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  }

  private toPublicUser(user: UserRow): PublicUser {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _ph, ...publicUser } = user;
    return publicUser;
  }
}
