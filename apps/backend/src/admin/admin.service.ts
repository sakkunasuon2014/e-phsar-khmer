import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient, DbExecutor } from '../db/drizzle.provider';
import { users, userPhones } from '../db/schema/users.schema';
import type { UserRow } from '../db/schema/users.schema';
import { listings } from '../db/schema/listings.schema';
import { userSubscriptions } from '../db/schema/subscriptions.schema';
import type {
  PaginatedResponse,
  RequestUser,
} from '../common/types/api-response.types';
import type { ListUsersDto } from './dto/list-users.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { StatsRange } from './dto/timeseries-query.dto';
import {
  assertCanManageUser,
  revokesSuperAdmin,
  type ManageChange,
} from './admin-user-policy';

const SALT_ROUNDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
// Cambodia is ICT (UTC+7) with no daylight saving — a fixed offset is exact.
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

export type PublicUser = Omit<UserRow, 'passwordHash'>;
export type PublicUserWithAccount = PublicUser & {
  accountType: 'Premium' | 'Normal';
};

export interface StatMetric {
  value: number;
  changePct: number;
  trend: 'up' | 'down';
}

export interface AdminStats {
  totalUsers: StatMetric;
  newUsers: StatMetric;
  totalListings: StatMetric;
  activeListings: StatMetric;
}

export interface TimeseriesPoint {
  date: string;
  newUsers: number;
  newListings: number;
}

@Injectable()
export class AdminService {
  constructor(@Inject(DRIZZLE) private readonly db: DbClient) {}

  private toPublic(user: UserRow): PublicUser {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _ph, ...rest } = user;
    return rest;
  }

  /** Build a card metric: `value` is the headline, `changePct`/`trend` compare
   *  the current 30-day inflow (`cur`) to the prior 30-day inflow (`prev`). */
  private metric(value: number, cur: number, prev: number): StatMetric {
    let changePct: number;
    if (prev === 0) changePct = cur > 0 ? 100 : 0;
    else changePct = Math.round(((cur - prev) / prev) * 1000) / 10;
    return { value, changePct, trend: cur >= prev ? 'up' : 'down' };
  }

  async getStats(): Promise<AdminStats> {
    const now = Date.now();
    const d30 = new Date(now - 30 * DAY_MS);
    const d60 = new Date(now - 60 * DAY_MS);
    const c = (): { value: ReturnType<typeof count> } => ({ value: count() });

    const [
      [totalUsers],
      [usersCur],
      [usersPrev],
      [totalListings],
      [listingsCur],
      [listingsPrev],
      [activeListings],
      [activeCur],
      [activePrev],
    ] = await Promise.all([
      this.db.select(c()).from(users).where(ne(users.status, 'deleted')),
      this.db
        .select(c())
        .from(users)
        .where(and(ne(users.status, 'deleted'), gte(users.createdAt, d30))),
      this.db
        .select(c())
        .from(users)
        .where(
          and(
            ne(users.status, 'deleted'),
            gte(users.createdAt, d60),
            lt(users.createdAt, d30),
          ),
        ),
      this.db.select(c()).from(listings).where(ne(listings.status, 'deleted')),
      this.db.select(c()).from(listings).where(gte(listings.createdAt, d30)),
      this.db
        .select(c())
        .from(listings)
        .where(and(gte(listings.createdAt, d60), lt(listings.createdAt, d30))),
      this.db.select(c()).from(listings).where(eq(listings.status, 'active')),
      this.db
        .select(c())
        .from(listings)
        .where(
          and(eq(listings.status, 'active'), gte(listings.createdAt, d30)),
        ),
      this.db
        .select(c())
        .from(listings)
        .where(
          and(
            eq(listings.status, 'active'),
            gte(listings.createdAt, d60),
            lt(listings.createdAt, d30),
          ),
        ),
    ]);

    return {
      totalUsers: this.metric(
        totalUsers.value,
        usersCur.value,
        usersPrev.value,
      ),
      newUsers: this.metric(usersCur.value, usersCur.value, usersPrev.value),
      totalListings: this.metric(
        totalListings.value,
        listingsCur.value,
        listingsPrev.value,
      ),
      activeListings: this.metric(
        activeListings.value,
        activeCur.value,
        activePrev.value,
      ),
    };
  }

  async getTimeseries(range: StatsRange): Promise<TimeseriesPoint[]> {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;

    // Bucket by Cambodia calendar day (ICT = UTC+7, no DST → fixed offset).
    // `since` is the UTC instant at the start of the earliest ICT day in range;
    // `sinceUtc + i*DAY` lands exactly on each subsequent ICT midnight.
    const now = Date.now();
    const ictNow = new Date(now + ICT_OFFSET_MS); // shift so UTC fields read ICT wall clock
    const startOfTodayIct =
      Date.UTC(
        ictNow.getUTCFullYear(),
        ictNow.getUTCMonth(),
        ictNow.getUTCDate(),
      ) - ICT_OFFSET_MS;
    const since = new Date(startOfTodayIct - (days - 1) * DAY_MS);

    const userDay = sql`date_trunc('day', ${users.createdAt} AT TIME ZONE 'Asia/Phnom_Penh')`;
    const listingDay = sql`date_trunc('day', ${listings.createdAt} AT TIME ZONE 'Asia/Phnom_Penh')`;

    const [userRows, listingRows] = await Promise.all([
      this.db
        .select({
          day: sql<string>`to_char(${userDay}, 'YYYY-MM-DD')`,
          c: count(),
        })
        .from(users)
        .where(gte(users.createdAt, since))
        .groupBy(userDay),
      this.db
        .select({
          day: sql<string>`to_char(${listingDay}, 'YYYY-MM-DD')`,
          c: count(),
        })
        .from(listings)
        .where(gte(listings.createdAt, since))
        .groupBy(listingDay),
    ]);

    const userMap = new Map(userRows.map((r) => [r.day, Number(r.c)]));
    const listingMap = new Map(listingRows.map((r) => [r.day, Number(r.c)]));

    const out: TimeseriesPoint[] = [];
    for (let i = 0; i < days; i++) {
      // Re-add the offset so the UTC date fields spell the ICT calendar day.
      const key = new Date(since.getTime() + i * DAY_MS + ICT_OFFSET_MS)
        .toISOString()
        .slice(0, 10);
      out.push({
        date: key,
        newUsers: userMap.get(key) ?? 0,
        newListings: listingMap.get(key) ?? 0,
      });
    }
    return out;
  }

  async listUsers(
    dto: ListUsersDto,
  ): Promise<PaginatedResponse<PublicUserWithAccount>> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (dto.status) {
      conditions.push(eq(users.status, dto.status));
    } else {
      conditions.push(ne(users.status, 'deleted'));
    }
    if (dto.role) conditions.push(eq(users.role, dto.role));
    if (dto.q) {
      const term = `%${dto.q}%`;
      conditions.push(
        or(
          ilike(users.username, term),
          ilike(users.email, term),
          ilike(users.firstName, term),
          ilike(users.lastName, term),
          ilike(users.primaryPhone, term),
        )!,
      );
    }
    const where = and(...conditions);

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ value: count() }).from(users).where(where),
    ]);

    const total = totalRow.value;

    // Premium = has an active (non-expired) subscription. Query just the page's users.
    const pageUserIds = rows.map((r) => r.id);
    const premium = new Set<string>();
    if (pageUserIds.length) {
      const active = await this.db
        .selectDistinct({ userId: userSubscriptions.userId })
        .from(userSubscriptions)
        .where(
          and(
            inArray(userSubscriptions.userId, pageUserIds),
            isNull(userSubscriptions.supersededAt),
            gt(userSubscriptions.expiresAt, new Date()),
          ),
        );
      for (const a of active) premium.add(a.userId);
    }

    return {
      data: rows.map((r) => ({
        ...this.toPublic(r),
        accountType: premium.has(r.id)
          ? ('Premium' as const)
          : ('Normal' as const),
      })),
      meta: {
        nextCursor: null,
        hasMore: offset + rows.length < total,
        limit: pageSize,
        total,
        page,
        pageSize,
      },
    };
  }

  async getUser(id: string): Promise<PublicUser> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new NotFoundException('User not found');
    return this.toPublic(user);
  }

  async createUser(
    dto: CreateUserDto,
    requester: RequestUser,
  ): Promise<PublicUser> {
    // Only super_admin can assign admin or super_admin roles.
    if (dto.role && dto.role !== 'user' && requester.role !== 'super_admin') {
      throw new ForbiddenException('ONLY_SUPER_ADMIN_CAN_ASSIGN_ADMIN_ROLES');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const primaryPhone = dto.phones?.[0] ?? null;

    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            username: dto.username,
            passwordHash,
            role: dto.role ?? 'user',
            firstName: dto.firstName ?? null,
            lastName: dto.lastName ?? null,
            email: dto.email ?? null,
            primaryPhone,
          })
          .returning();

        if (dto.phones?.length) {
          await tx.insert(userPhones).values(
            dto.phones.map((phone, i) => ({
              userId: user.id,
              phone,
              isPrimary: i === 0,
            })),
          );
        }

        return this.toPublic(user);
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('Username, email, or phone already in use');
      }
      throw err;
    }
  }

  async updateUser(
    id: string,
    dto: UpdateUserDto,
    requester: RequestUser,
  ): Promise<PublicUser> {
    // Who may change what is decided in the transaction below, against the
    // locked target row (authorizeManage).
    const patch: Partial<UserRow> = {};
    if (dto.username !== undefined) patch.username = dto.username;
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.firstName !== undefined) patch.firstName = dto.firstName;
    if (dto.lastName !== undefined) patch.lastName = dto.lastName;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.password)
      patch.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    if (dto.phones?.[0]) patch.primaryPhone = dto.phones[0];

    try {
      return await this.db.transaction(async (tx) => {
        await this.authorizeManage(tx, requester, id, {
          role: dto.role,
          status: dto.status,
        });

        if (Object.keys(patch).length > 0) {
          await tx.update(users).set(patch).where(eq(users.id, id));
        }

        if (dto.phones) {
          await tx.delete(userPhones).where(eq(userPhones.userId, id));
          if (dto.phones.length) {
            await tx.insert(userPhones).values(
              dto.phones.map((phone, i) => ({
                userId: id,
                phone,
                isPrimary: i === 0,
              })),
            );
          }
        }

        const [updated] = await tx
          .select()
          .from(users)
          .where(eq(users.id, id))
          .limit(1);
        return this.toPublic(updated);
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('Username, email, or phone already in use');
      }
      throw err;
    }
  }

  async deleteUser(
    id: string,
    requester: RequestUser,
  ): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      await this.authorizeManage(tx, requester, id, { delete: true });

      // Free globally-unique phone rows so identifiers can be reused. Nulling
      // `primaryPhone` here is also what marks this as an ADMIN deletion:
      // AuthService.findRecoverable only revives a soft-deleted account that
      // still has a phone, so an account removed this way can never be
      // brought back by signing in. UsersService.deleteOwnAccount keeps it.
      await tx.delete(userPhones).where(eq(userPhones.userId, id));
      await tx
        .update(users)
        .set({ status: 'deleted', deletedAt: new Date(), primaryPhone: null })
        .where(eq(users.id, id));

      return { id };
    });
  }

  /**
   * Locks the target row and applies `assertCanManageUser`. When the change
   * would strip a super_admin, every active super_admin row is locked and
   * counted in the same transaction, so two of them demoting each other
   * concurrently serialize and the second sees only one left.
   *
   * Public so other admin actions that change an account (approving a user
   * report suspends its target) go through the same rules.
   */
  async authorizeManage(
    tx: DbExecutor,
    requester: RequestUser,
    id: string,
    change: ManageChange,
  ): Promise<void> {
    const [target] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .for('update');
    if (!target) throw new NotFoundException('User not found');

    let activeSuperAdmins: number | undefined;
    if (revokesSuperAdmin(target, change)) {
      const rows = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, 'super_admin'),
            eq(users.status, 'active'),
            isNull(users.deletedAt),
          ),
        )
        .for('update');
      activeSuperAdmins = rows.length;
    }
    assertCanManageUser(requester, target, change, activeSuperAdmins);
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    );
  }
}
