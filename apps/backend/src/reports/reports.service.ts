import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import { users } from '../db/schema/users.schema';
import { listings } from '../db/schema/listings.schema';
import {
  listingReports,
  reportReasons,
  userReports,
} from '../db/schema/reports.schema';
import { FilesService } from '../files/files.service';
import type {
  CreateListingReportDto,
  CreateUserReportDto,
} from './dto/create-report.dto';

/**
 * The user side of reporting: read the admin-managed reasons, file a report
 * against a listing or an account. Review happens in the admin module
 * (`src/admin/reports/`), which is where approval takes its action.
 */
@Injectable()
export class UserReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly files: FilesService,
  ) {}

  listReasons(targetType: 'user' | 'listing') {
    return this.db
      .select({ id: reportReasons.id, reason: reportReasons.reason })
      .from(reportReasons)
      .where(
        and(
          eq(reportReasons.targetType, targetType),
          eq(reportReasons.isActive, true),
        ),
      )
      .orderBy(asc(reportReasons.sortOrder), asc(reportReasons.reason));
  }

  async reportListing(reporterId: string, dto: CreateListingReportDto) {
    const [listing] = await this.db
      .select({ userId: listings.userId, moderatedAt: listings.moderatedAt })
      .from(listings)
      .where(eq(listings.id, dto.listingId))
      .limit(1);
    if (!listing || listing.moderatedAt) {
      throw new NotFoundException('Listing not found');
    }
    if (listing.userId === reporterId) {
      throw new BadRequestException('CANNOT_REPORT_OWN_LISTING');
    }
    await this.assertReason(dto.reasonId, 'listing');

    return this.insertOnce(() =>
      this.db
        .insert(listingReports)
        .values({
          reporterId,
          listingId: dto.listingId,
          reasonId: dto.reasonId,
          description: dto.description?.trim() || null,
        })
        .returning({ id: listingReports.id }),
    );
  }

  async reportUser(reporterId: string, dto: CreateUserReportDto) {
    if (dto.targetUserId === reporterId) {
      throw new BadRequestException('CANNOT_REPORT_SELF');
    }
    const [target] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, dto.targetUserId), isNull(users.deletedAt)))
      .limit(1);
    if (!target) throw new NotFoundException('User not found');
    await this.assertReason(dto.reasonId, 'user');
    const imagePaths = dto.imagePaths ?? [];
    for (const path of imagePaths) {
      // Only the reporter's own uploads — the admin page renders these, so a
      // foreign path would let a report display someone else's image.
      if (
        !this.files.isOwnedPath(path, reporterId) ||
        !path.startsWith(`report/${reporterId}/`)
      ) {
        throw new BadRequestException('INVALID_IMAGE');
      }
    }

    return this.insertOnce(() =>
      this.db
        .insert(userReports)
        .values({
          reporterId,
          targetUserId: dto.targetUserId,
          reasonId: dto.reasonId,
          description: dto.description?.trim() || null,
          imagePaths,
        })
        .returning({ id: userReports.id }),
    );
  }

  private async assertReason(id: string, targetType: 'user' | 'listing') {
    const [reason] = await this.db
      .select({ id: reportReasons.id })
      .from(reportReasons)
      .where(
        and(
          eq(reportReasons.id, id),
          eq(reportReasons.targetType, targetType),
          eq(reportReasons.isActive, true),
        ),
      )
      .limit(1);
    if (!reason) throw new BadRequestException('INVALID_REASON');
  }

  /**
   * The pending-report partial unique index is the dedupe: a second report
   * while the first is still open is a 409, not a second queue row.
   */
  private async insertOnce(
    insert: () => Promise<Array<{ id: string }>>,
  ): Promise<{ id: string }> {
    try {
      const [row] = await insert();
      return row;
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: unknown }).code === '23505'
      ) {
        throw new ConflictException('ALREADY_REPORTED');
      }
      throw err;
    }
  }
}
