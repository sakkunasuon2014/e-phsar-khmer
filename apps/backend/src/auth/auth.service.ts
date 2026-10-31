import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { and, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import {
  users,
  userAuthProviders,
  userPhones,
} from '../db/schema/users.schema';
import type { UserRow } from '../db/schema/users.schema';
import { SupabaseService } from '../common/supabase/supabase.service';
import type { LoginDto } from './dto/login.dto';
import type { LoginOtpDto } from './dto/login-otp.dto';
import type { RegisterDto } from './dto/register.dto';
import type { VerifyOtpDto } from './dto/verify-otp.dto';
import type { RefreshDto } from './dto/refresh.dto';
import type { SocialLoginDto } from './dto/social-login.dto';
import type { LinkSocialProviderDto } from './dto/link-social-provider.dto';
import {
  buildUsernameBase,
  generateUniqueUsername,
  normalizeUsername,
} from '../users/username.util';
import { isPhoneBanned } from '../reports/phone-ban.util';
import { ACCOUNT_RETENTION_DAYS } from '../users/account-purge.service';
import type { ClientDeviceInfo } from './client-device.decorator';
import { LoginDevicesService } from './login-devices.service';
import { hasActivePaidSubscription } from '../subscriptions/verified-account.util';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

/** Mirrors AdminService.createUser bcrypt cost. */
const PASSWORD_SALT_ROUNDS = 10;

/** A `sid` is a row UUID; reject anything else before it reaches Postgres. */
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** postgres.js exposes the SQLSTATE on the error object. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export type PublicUser = Omit<UserRow, 'passwordHash'>;

/** Every successful login path returns this shape. */
export interface AuthResult extends AuthTokens {
  user: PublicUser;
  /** True when this login came from a new, non-first device. */
  newDevice: boolean;
}

export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly loginDevices: LoginDevicesService,
  ) {}

  async loginWithPassword(
    dto: LoginDto,
    device: ClientDeviceInfo | null = null,
  ): Promise<AuthResult> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(
        and(
          or(
            eq(users.username, dto.identifier),
            // Generated and self-chosen handles are stored lowercased, so
            // "SokDara" must find "sokdara". The exact match above still
            // serves admin-created mixed-case usernames.
            eq(users.username, normalizeUsername(dto.identifier)),
            eq(users.primaryPhone, dto.identifier),
          ),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    if (!user) {
      // No active account matches, but the identifier may belong to one its
      // owner deleted inside the recovery window — signing back in is how
      // they undo that (the settings page promises it, and the account is
      // still intact until AccountPurgeService runs).
      const recoverable = await this.findRecoverable(dto.identifier);
      if (!recoverable?.passwordHash) {
        throw new UnauthorizedException('INVALID_CREDENTIALS');
      }

      const matches = await bcrypt.compare(
        dto.password,
        recoverable.passwordHash,
      );
      if (!matches) throw new UnauthorizedException('INVALID_CREDENTIALS');

      const revived = await this.revive(recoverable.id);
      return this.finishLogin(revived, device);
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('INVALID_CREDENTIALS');
    // Unreachable while the lookup above filters deleted rows out, but kept as
    // the guard it has always been: it is the only thing between a deleted
    // account and a token if that filter is ever lifted. Recovery goes through
    // findRecoverable() above, which is deliberate about which rows qualify.
    if (user.deletedAt) throw new UnauthorizedException('Account deactivated');
    if (user.status !== 'active')
      throw new UnauthorizedException('Account suspended');

    return this.finishLogin(user, device);
  }

  async registerWithPhone(dto: RegisterDto): Promise<{ otpSent: true }> {
    await this.assertPhoneNotBanned(dto.phone);
    await this.supabaseService.signInWithOtp(dto.phone);
    return { otpSent: true };
  }

  async verifyPhoneOtp(
    dto: VerifyOtpDto,
    device: ClientDeviceInfo | null = null,
  ): Promise<AuthResult> {
    // Moderation ban first: a banned number must not even burn an OTP.
    await this.assertPhoneNotBanned(dto.phone);
    // Password is checked BEFORE the Supabase call so a wrong password
    // never burns an OTP attempt. For an existing user this is a login
    // (password must match); for an absent user this is a registration
    // (the password becomes the account's passwordHash).
    const [existing] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.primaryPhone, dto.phone), isNull(users.deletedAt)))
      .limit(1);

    // This endpoint bypasses loginWithPassword, so it needs its own
    // suspension guard — otherwise a suspended account could mint tokens
    // through the OTP login flow.
    if (existing) this.assertAccountActive(existing);

    // A legacy bare account (created before passwords were required) is
    // COMPLETED in place: possessing the OTP proves phone ownership, so the
    // submitted password (and names) become the account's. An account that
    // already has a password must match it — credentials are never replaced
    // through this endpoint.
    const completingBareAccount =
      existing !== undefined && !existing.passwordHash;

    if (existing && existing.passwordHash) {
      const valid = await bcrypt.compare(dto.password, existing.passwordHash);
      if (!valid) throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    // Same recovery window as the password path: a deleted account still
    // answers to its phone, so this revives it instead of letting
    // mirrorSupabaseUser create a second account for the same number. The
    // password is still checked BEFORE the Supabase call, so a wrong one
    // never burns an OTP attempt.
    const recoverable = existing ? null : await this.findRecoverable(dto.phone);
    if (recoverable?.passwordHash) {
      const matches = await bcrypt.compare(
        dto.password,
        recoverable.passwordHash,
      );
      if (!matches) throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const { data, error } = await this.supabaseService.verifyOtp(
      dto.phone,
      dto.token,
    );
    if (error || !data.user)
      throw new UnauthorizedException('Invalid or expired OTP');

    if (recoverable) {
      const revived = await this.revive(recoverable.id);
      return this.finishLogin(revived, device);
    }

    if (completingBareAccount) {
      const updateData: Partial<typeof users.$inferInsert> = {
        passwordHash: await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS),
        updatedAt: new Date(),
      };
      if (dto.firstName !== undefined) updateData.firstName = dto.firstName;
      if (dto.lastName !== undefined) updateData.lastName = dto.lastName;
      if (existing.username === null) {
        const base = buildUsernameBase(
          dto.firstName ?? existing.firstName,
          dto.lastName ?? existing.lastName,
        );
        if (base !== null) {
          updateData.username = await generateUniqueUsername(this.db, base);
        }
      }

      const [row] = await this.db
        .update(users)
        .set(updateData)
        .where(and(eq(users.id, existing.id), isNull(users.deletedAt)))
        .returning();

      return this.finishLogin(row, device);
    }

    // Extras land ONLY in the INSERT values — the conflict path (existing
    // user logging in) must never overwrite password/names/username.
    const insertExtras: Partial<typeof users.$inferInsert> = {};
    if (!existing) {
      insertExtras.passwordHash = await bcrypt.hash(
        dto.password,
        PASSWORD_SALT_ROUNDS,
      );
      if (dto.firstName !== undefined) insertExtras.firstName = dto.firstName;
      if (dto.lastName !== undefined) insertExtras.lastName = dto.lastName;
      const base = buildUsernameBase(dto.firstName, dto.lastName);
      if (base !== null) {
        insertExtras.username = await generateUniqueUsername(this.db, base);
      }
    }

    const user = await this.mirrorSupabaseUser(
      data.user,
      'phone',
      dto.phone,
      insertExtras,
    );
    this.assertAccountActive(user);
    return this.finishLogin(user, device);
  }

  async requestPhoneOtp(phone: string): Promise<{ otpSent: true }> {
    await this.assertPhoneNotBanned(phone);
    await this.supabaseService.signInWithOtp(phone);
    return { otpSent: true };
  }

  async requestLoginOtp(dto: LoginOtpDto): Promise<{ otpSent: true }> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.primaryPhone, dto.phone), isNull(users.deletedAt)))
      .limit(1);

    if (!user || !user.passwordHash)
      throw new UnauthorizedException('INVALID_CREDENTIALS');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('INVALID_CREDENTIALS');

    // After the credential check on purpose: a wrong password still answers
    // 401 with no SMS, so the ban is not an oracle for a number the caller
    // cannot prove they own.
    await this.assertPhoneNotBanned(dto.phone);

    await this.supabaseService.signInWithOtp(dto.phone);
    return { otpSent: true };
  }

  async getSocialAuthUrl(
    provider: string,
    redirectTo?: string,
  ): Promise<{ url: string }> {
    if (provider !== 'google' && provider !== 'facebook')
      throw new BadRequestException('UNSUPPORTED_PROVIDER');

    const safeRedirect = this.resolveSocialRedirectTo(redirectTo);
    const { data, error } = await this.supabaseService.signInWithOAuth(
      provider,
      safeRedirect,
    );
    if (error || !data.url)
      throw new UnauthorizedException('Failed to get social auth URL');
    return { url: data.url };
  }

  /**
   * The URL route is public, so `redirectTo` is attacker-controlled until
   * proven otherwise: only our own frontend origins may receive the OAuth
   * tokens. When FRONTEND_ORIGINS is configured it is an exact-origin match;
   * when it is not, development only loops back to localhost and production
   * fails closed. Supabase's redirect allow-list is the second line of
   * defence, never the only one.
   */
  private resolveSocialRedirectTo(redirectTo?: string): string | undefined {
    if (!redirectTo) return undefined;

    let url: URL;
    try {
      url = new URL(redirectTo);
    } catch {
      throw new BadRequestException('INVALID_REDIRECT_URI');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new BadRequestException('INVALID_REDIRECT_URI');
    if (url.username || url.password || url.hash)
      throw new BadRequestException('INVALID_REDIRECT_URI');

    const allowed = (
      this.configService.get<string[]>('frontendOrigins') ?? []
    ).map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin.replace(/\/+$/, '');
      }
    });

    if (allowed.length > 0) {
      if (!allowed.includes(url.origin))
        throw new BadRequestException('INVALID_REDIRECT_URI');
      return url.toString();
    }

    const isLoopback =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]';
    if (process.env.NODE_ENV === 'production' || !isLoopback)
      throw new BadRequestException('INVALID_REDIRECT_URI');

    return url.toString();
  }

  async handleSocialCallback(
    dto: SocialLoginDto,
    device: ClientDeviceInfo | null = null,
  ): Promise<AuthResult> {
    if (!dto.accessToken)
      throw new UnauthorizedException(
        'accessToken is required for social callback',
      );
    const { data, error } = await this.supabaseService.getUser(dto.accessToken);
    if (error || !data.user)
      throw new UnauthorizedException('Invalid social access token');

    // The token must actually belong to the provider the client claims: a
    // Google token presented as `facebook` would otherwise be recorded as a
    // Facebook link for that account.
    this.assertSocialProvider(data.user, dto.provider);
    this.assertConfirmedSocialEmail(data.user);

    const user =
      dto.mode === 'admin'
        ? await this.resolveSocialAdminUser(dto.provider, data.user)
        : await this.mirrorSupabaseUser(
            {
              id: data.user.id,
              email: data.user.email,
              phone: data.user.phone,
            },
            dto.provider,
          );
    this.assertAccountActive(user);
    return this.finishLogin(user, device);
  }

  /**
   * Attach a provider identity to the signed-in account. This never mints
   * tokens and never matches on email: the caller is authenticated, so the
   * provider identity is linked as-is. The emailed login path keeps its own
   * `email_confirmed_at` gate.
   */
  async linkSocialProvider(
    userId: string,
    dto: LinkSocialProviderDto,
  ): Promise<{
    provider: 'google' | 'facebook';
    providerAccountId: string;
    linked: true;
  }> {
    const { data, error } = await this.supabaseService.getUser(dto.accessToken);
    if (error || !data.user)
      throw new UnauthorizedException({
        code: 'INVALID_PROVIDER_TOKEN',
        message: 'Invalid social access token',
      });

    this.assertSocialProvider(data.user, dto.provider);
    const providerAccountId = data.user.id?.trim();
    if (!providerAccountId || providerAccountId.length > 120)
      throw new UnauthorizedException({
        code: 'INVALID_PROVIDER_TOKEN',
        message: 'Invalid social access token',
      });

    const linkedTo = await this.findUserByProviderAccount(
      dto.provider,
      providerAccountId,
    );
    if (linkedTo && linkedTo.id !== userId)
      throw new ConflictException({
        code: 'PROVIDER_ACCOUNT_ALREADY_LINKED',
        message: 'That account is already connected to another user.',
      });

    const [existing] = await this.db
      .select()
      .from(userAuthProviders)
      .where(
        and(
          eq(userAuthProviders.userId, userId),
          eq(userAuthProviders.provider, dto.provider),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.providerAccountId === providerAccountId)
        return { provider: dto.provider, providerAccountId, linked: true };
      if (existing.providerAccountId !== null)
        throw new ConflictException({
          code: 'PROVIDER_ALREADY_LINKED',
          message:
            'A different account for this provider is already connected.',
        });

      // A legacy row with no account id: fill it in rather than 409.
      await this.db
        .update(userAuthProviders)
        .set({ providerAccountId })
        .where(eq(userAuthProviders.id, existing.id));
      return { provider: dto.provider, providerAccountId, linked: true };
    }

    try {
      await this.db.insert(userAuthProviders).values({
        userId,
        provider: dto.provider,
        providerAccountId,
      });
    } catch (error) {
      // The unique (userId, provider) index catches a concurrent link.
      if (isUniqueViolation(error))
        throw new ConflictException({
          code: 'PROVIDER_ALREADY_LINKED',
          message: 'This provider is already connected to your account.',
        });
      throw error;
    }

    return { provider: dto.provider, providerAccountId, linked: true };
  }

  /**
   * Remove a linked provider. Refuses when it is the account's last way in:
   * a phone, a username + password, or another provider row must remain. The
   * user row is locked so two concurrent unlinks cannot each count the other
   * as the remaining method.
   */
  async unlinkSocialProvider(
    userId: string,
    provider: string,
  ): Promise<{ provider: string; unlinked: boolean }> {
    if (
      provider !== 'google' &&
      provider !== 'facebook' &&
      provider !== 'telegram'
    )
      throw new BadRequestException({
        code: 'UNSUPPORTED_PROVIDER',
        message: 'Unsupported provider',
      });

    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!user)
        throw new UnauthorizedException({
          code: 'ACCOUNT_NOT_FOUND',
          message: 'Account not found',
        });

      const rows = await tx
        .select({
          provider: userAuthProviders.provider,
          providerAccountId: userAuthProviders.providerAccountId,
        })
        .from(userAuthProviders)
        .where(eq(userAuthProviders.userId, userId));

      const isLinked = rows.some((row) => row.provider === provider);
      if (!isLinked) return { provider, unlinked: false };

      const hasFallback =
        user.primaryPhone !== null ||
        (user.username !== null && user.passwordHash !== null) ||
        rows.some(
          (row) =>
            row.provider !== provider &&
            row.providerAccountId !== null &&
            (row.provider === 'google' ||
              row.provider === 'facebook' ||
              row.provider === 'telegram'),
        );
      if (!hasFallback)
        throw new ConflictException({
          code: 'LAST_LOGIN_METHOD',
          message: 'This is your only way to sign in.',
        });

      await tx
        .delete(userAuthProviders)
        .where(
          and(
            eq(userAuthProviders.userId, userId),
            eq(userAuthProviders.provider, provider),
          ),
        );

      return { provider, unlinked: true };
    });
  }

  async loginWithTelegram(
    payload: TelegramAuthPayload,
    device: ClientDeviceInfo | null = null,
  ): Promise<AuthResult> {
    const botToken = this.configService.get<string>('telegram.botToken');
    if (!botToken)
      throw new UnauthorizedException('Telegram login not configured');

    // The payload is an interface, so the ValidationPipe never checks it — a
    // missing or non-hex hash would otherwise throw inside Buffer.from (500).
    if (
      typeof payload?.hash !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(payload.hash) ||
      typeof payload.auth_date !== 'number'
    ) {
      throw new UnauthorizedException('Invalid Telegram auth data');
    }

    const secretKey = createHash('sha256').update(botToken).digest();
    const checkString = Object.entries(payload)
      .filter(([k]) => k !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('\n');

    const hmac = createHmac('sha256', secretKey)
      .update(checkString)
      .digest('hex');
    const receivedHash = Buffer.from(payload.hash, 'hex');
    const computedHash = Buffer.from(hmac, 'hex');

    if (
      receivedHash.length !== computedHash.length ||
      !timingSafeEqual(receivedHash, computedHash)
    ) {
      throw new UnauthorizedException('Invalid Telegram auth data');
    }

    const authAge = Math.floor(Date.now() / 1000) - payload.auth_date;
    if (authAge > 86400)
      throw new UnauthorizedException('Telegram auth data expired');

    const telegramId = String(payload.id);

    const [existingLink] = await this.db
      .select()
      .from(userAuthProviders)
      .where(
        and(
          eq(userAuthProviders.provider, 'telegram'),
          eq(userAuthProviders.providerAccountId, telegramId),
        ),
      )
      .limit(1);

    let user: UserRow;
    if (existingLink) {
      const [found] = await this.db
        .select()
        .from(users)
        .where(eq(users.id, existingLink.userId))
        .limit(1);
      if (!found) throw new UnauthorizedException('User not found');
      user = found;
    } else {
      const base = buildUsernameBase(payload.first_name, payload.last_name);
      const username =
        base !== null ? await generateUniqueUsername(this.db, base) : null;
      const [inserted] = await this.db
        .insert(users)
        .values({
          firstName: payload.first_name ?? null,
          lastName: payload.last_name ?? null,
          username,
          profilePhotoUrl: payload.photo_url ?? null,
        })
        .returning();
      user = inserted;

      await this.db.insert(userAuthProviders).values({
        userId: user.id,
        provider: 'telegram',
        providerAccountId: telegramId,
      });
    }

    this.assertAccountActive(user);
    return this.finishLogin(user, device);
  }

  async refresh(
    dto: RefreshDto,
    device: ClientDeviceInfo | null = null,
  ): Promise<AuthTokens> {
    let payload: {
      sub: string;
      role: 'user' | 'admin' | 'super_admin';
      sid?: string;
    };
    try {
      payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.sid !== undefined && !SESSION_ID_PATTERN.test(payload.sid)) {
      throw new UnauthorizedException('Invalid session');
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user || user.status !== 'active' || user.deletedAt)
      throw new UnauthorizedException('User not found');

    // New tokens carry the row's revocation epoch. A rotated id means the
    // device was revoked, so the refresh token dies with the access token.
    if (payload.sid) {
      const active = await this.loginDevices.touchActiveSession(
        user.id,
        payload.sid,
      );
      if (!active) throw new UnauthorizedException('Session revoked');
      return this.issueTokens(user, payload.sid);
    }

    // A legacy (no-`sid`) refresh token can be bound on its first refresh.
    // A row that exists but was revoked must reject — never fall back to a
    // sid-less token for a device we know was signed out.
    if (device) {
      const row = await this.loginDevices.findSessionByDeviceId(
        user.id,
        device.id,
      );
      if (row) {
        if (row.revokedAt) throw new UnauthorizedException('Session revoked');
        const active = await this.loginDevices.touchActiveSession(
          user.id,
          row.sessionId,
        );
        if (!active) throw new UnauthorizedException('Session revoked');
        return this.issueTokens(user, row.sessionId);
      }
    }

    return this.issueTokens(user);
  }

  /**
   * The account a sign-in should bring back: soft-deleted, inside the
   * retention window, and still holding a phone number.
   *
   * That last condition is the whole distinction between the two ways an
   * account becomes soft-deleted. `UsersService.deleteOwnAccount` keeps the
   * phone — recovery has to be possible — while `AdminService.deleteUser`
   * clears it. So "still has a phone" means the owner left on their own, and
   * an account an admin removed can never be revived by signing in.
   */
  private async findRecoverable(identifier: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(
          or(
            eq(users.username, identifier),
            eq(users.username, normalizeUsername(identifier)),
            eq(users.primaryPhone, identifier),
          ),
          isNotNull(users.deletedAt),
          isNotNull(users.primaryPhone),
          // The database's clock, not this process's — the same window the
          // purge sweeper evaluates.
          gt(
            users.deletedAt,
            sql`now() - make_interval(days => ${ACCOUNT_RETENTION_DAYS})`,
          ),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Clears the deletion. Idempotent — a concurrent sign-in may have won the race. */
  private async revive(userId: string): Promise<UserRow> {
    const [row] = await this.db
      .update(users)
      .set({ status: 'active', deletedAt: null })
      .where(and(eq(users.id, userId), isNotNull(users.deletedAt)))
      .returning();
    if (row) return row;

    const [current] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!current) throw new UnauthorizedException('INVALID_CREDENTIALS');
    return current;
  }

  /**
   * Every token-issuing path must pass through this. `loginWithPassword` and
   * `refresh` check inline; the alternate providers (OTP verify, social,
   * Telegram) do not, and a suspended account must not mint a session through
   * any of them.
   */
  private assertAccountActive(user: UserRow): void {
    if (user.status !== 'active' || user.deletedAt)
      throw new UnauthorizedException('Account suspended');
  }

  /**
   * Moderation ban. The number may never register, receive an OTP, or be
   * added to another account — the ban outlives the account's hard purge.
   */
  private async assertPhoneNotBanned(phone: string): Promise<void> {
    if (await isPhoneBanned(this.db, phone)) {
      throw new ForbiddenException({
        code: 'PHONE_BANNED',
        message: 'This phone number has been banned.',
      });
    }
  }

  /**
   * The single success exit for every login path: records the device first,
   * then signs tokens carrying its revocation epoch (`sid`). `recordLogin`
   * never throws, so a device or notification failure cannot turn a valid
   * credential check into a 500; a row that could not be written yields a
   * token without `sid`, exactly like a legacy session.
   */
  private async finishLogin(
    user: UserRow,
    device: ClientDeviceInfo | null,
  ): Promise<AuthResult> {
    const recorded = await this.loginDevices.recordLogin(user.id, device);
    const tokens = this.issueTokens(user, recorded.sessionId);
    return {
      ...tokens,
      user: this.toPublicUser(user),
      newDevice: recorded.isNewDevice,
    };
  }

  private issueTokens(
    user: UserRow,
    sessionId: string | null = null,
  ): AuthTokens {
    const jwtPayload = {
      sub: user.id,
      role: user.role,
      ...(sessionId ? { sid: sessionId } : {}),
    };
    const accessExpiresIn = (this.configService.get<string>(
      'jwt.accessExpiresIn',
    ) ?? '15m') as unknown as number;
    const refreshExpiresIn = (this.configService.get<string>(
      'jwt.refreshExpiresIn',
    ) ?? '30d') as unknown as number;
    const accessToken = this.jwtService.sign(jwtPayload, {
      expiresIn: accessExpiresIn,
    });
    const refreshToken = this.jwtService.sign(jwtPayload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: refreshExpiresIn,
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get<string>('jwt.accessExpiresIn') ?? '15m',
    };
  }

  private assertSocialProvider(
    user: {
      identities?: { provider?: string }[];
      app_metadata?: { provider?: string };
    },
    provider: 'google' | 'facebook',
  ): void {
    const identities = user.identities ?? [];
    const matches =
      identities.length > 0
        ? identities.some((identity) => identity.provider === provider)
        : user.app_metadata?.provider === provider;
    if (!matches) throw new UnauthorizedException('SOCIAL_PROVIDER_MISMATCH');
  }

  private assertConfirmedSocialEmail(user: {
    email?: string;
    email_confirmed_at?: string;
  }): void {
    if (!user.email?.trim())
      throw new UnauthorizedException('SOCIAL_EMAIL_REQUIRED');
    if (!user.email_confirmed_at)
      throw new UnauthorizedException('SOCIAL_EMAIL_UNVERIFIED');
  }

  /**
   * Social identity resolution, in order of trust:
   *   1. an existing (provider, provider account id) link — stable even when
   *      the provider email changes;
   *   2. a non-deleted account with the same confirmed email;
   *   3. a new account created by the email upsert (the partial unique index
   *      keeps concurrent first logins safe).
   */
  private async resolveSocialUser(
    provider: 'google' | 'facebook',
    providerAccountId: string,
    email: string,
  ): Promise<UserRow> {
    const linked = await this.findUserByProviderAccount(
      provider,
      providerAccountId,
    );
    if (linked) return linked;

    const existing = await this.findUserByEmail(email);
    if (existing) {
      await this.linkProvider(existing.id, provider, providerAccountId);
      return existing;
    }

    const [created] = await this.db
      .insert(users)
      .values({ email })
      .onConflictDoUpdate({
        target: users.email,
        targetWhere: isNull(users.deletedAt),
        set: { updatedAt: new Date() },
      })
      .returning();

    await this.linkProvider(created.id, provider, providerAccountId);
    return created;
  }

  /**
   * Admin social login only ever signs in an EXISTING staff account: no
   * insert and no revive. Every failure answers the same 401 so the endpoint
   * cannot be used to probe which emails are registered or which role they
   * hold.
   */
  private async resolveSocialAdminUser(
    provider: 'google' | 'facebook',
    supabaseUser: { id: string; email?: string },
  ): Promise<UserRow> {
    const email = supabaseUser.email?.trim().toLowerCase();
    if (!email) throw new UnauthorizedException('SOCIAL_LOGIN_NOT_ALLOWED');

    const linked = await this.findUserByProviderAccount(
      provider,
      supabaseUser.id,
    );
    const user = linked ?? (await this.findUserByEmail(email));

    if (
      !user ||
      user.deletedAt ||
      user.status !== 'active' ||
      (user.role !== 'admin' && user.role !== 'super_admin')
    ) {
      throw new UnauthorizedException('SOCIAL_LOGIN_NOT_ALLOWED');
    }

    await this.linkProvider(user.id, provider, supabaseUser.id);
    return user;
  }

  private async findUserByProviderAccount(
    provider: 'google' | 'facebook',
    providerAccountId: string,
  ): Promise<UserRow | null> {
    const [row] = await this.db
      .select({ user: users })
      .from(userAuthProviders)
      .innerJoin(users, eq(users.id, userAuthProviders.userId))
      .where(
        and(
          eq(userAuthProviders.provider, provider),
          eq(userAuthProviders.providerAccountId, providerAccountId),
        ),
      )
      .limit(1);
    return row?.user ?? null;
  }

  private async findUserByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${email.toLowerCase()}`,
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async linkProvider(
    userId: string,
    provider: 'google' | 'facebook',
    providerAccountId: string,
  ): Promise<void> {
    await this.db
      .insert(userAuthProviders)
      .values({ userId, provider, providerAccountId })
      .onConflictDoUpdate({
        target: [userAuthProviders.userId, userAuthProviders.provider],
        set: { providerAccountId },
      });
  }

  async mirrorSupabaseUser(
    supabaseUser: { id: string; phone?: string; email?: string },
    provider: 'phone' | 'google' | 'facebook',
    phone?: string,
    insertExtras?: Partial<typeof users.$inferInsert>,
  ): Promise<UserRow> {
    const resolvedPhone = phone ?? supabaseUser.phone ?? null;
    // Defence in depth: every caller that resolves a phone is checked at its
    // own entry point too, but this is the last gate before a row is created
    // or returned for a number moderation banned.
    if (resolvedPhone) await this.assertPhoneNotBanned(resolvedPhone);

    let user: UserRow;

    if (provider === 'phone') {
      const [row] = await this.db
        .insert(users)
        .values({ primaryPhone: resolvedPhone, ...insertExtras })
        .onConflictDoUpdate({
          target: users.primaryPhone,
          targetWhere: isNull(users.deletedAt),
          set: { updatedAt: new Date() },
        })
        .returning();
      user = row;

      await this.db
        .insert(userAuthProviders)
        .values({ userId: user.id, provider })
        .onConflictDoNothing({
          target: [userAuthProviders.userId, userAuthProviders.provider],
        });
    } else {
      const email = supabaseUser.email?.trim().toLowerCase();
      if (!email) throw new UnauthorizedException('SOCIAL_EMAIL_REQUIRED');
      user = await this.resolveSocialUser(provider, supabaseUser.id, email);
    }

    if (resolvedPhone) {
      await this.db
        .insert(userPhones)
        .values({ userId: user.id, phone: resolvedPhone, isPrimary: true })
        .onConflictDoNothing();
    }

    return user;
  }

  private toPublicUser(user: UserRow): PublicUser {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _ph, ...publicUser } = user;
    return publicUser;
  }

  async findById(
    id: string,
  ): Promise<PublicUser & { verifiedAccount: boolean }> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new NotFoundException('User not found');
    return {
      ...this.toPublicUser(user),
      verifiedAccount: await hasActivePaidSubscription(this.db, id),
    };
  }
}
