import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../db/drizzle.provider';
import type { DbClient } from '../../db/drizzle.provider';
import { users, userPhones } from '../../db/schema/users.schema';
import { listings } from '../../db/schema/listings.schema';
import {
  bannedPhones,
  reportReasons,
  userReports,
  listingReports,
} from '../../db/schema/reports.schema';
import { normalizePhoneE164 } from '../../reports/phone-ban.util';
import type {
  ReportReasonRow,
  UserReportRow,
  ListingReportRow,
} from '../../db/schema/reports.schema';
import type { RequestUser } from '../../common/types/api-response.types';
import { ListingsService } from '../../listings/listings.service';
import { AdminService } from '../admin.service';
import { FilesService } from '../../files/files.service';
import type {
  CreateReportReasonDto,
  UpdateReportReasonDto,
  UpdateReportStatusDto,
} from './dto/report.dto';

function nameOf(u: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}): string {
  return (
    [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '—'
  );
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly listingsService: ListingsService,
    private readonly adminService: AdminService,
    private readonly files: FilesService,
  ) {}

  // ── Reasons ───────────────────────────────────────────────
  listReasons(targetType?: 'user' | 'listing'): Promise<ReportReasonRow[]> {
    return this.db
      .select()
      .from(reportReasons)
      .where(targetType ? eq(reportReasons.targetType, targetType) : undefined)
      .orderBy(asc(reportReasons.sortOrder));
  }

  async createReason(dto: CreateReportReasonDto): Promise<ReportReasonRow> {
    try {
      const [row] = await this.db
        .insert(reportReasons)
        .values({ targetType: dto.targetType, reason: dto.reason })
        .returning();
      return row;
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('Reason already exists for that type');
      }
      throw err;
    }
  }

  async updateReason(
    id: string,
    dto: UpdateReportReasonDto,
  ): Promise<ReportReasonRow> {
    const rows = await this.db
      .update(reportReasons)
      .set(dto.reason ? { reason: dto.reason } : {})
      .where(eq(reportReasons.id, id))
      .returning();
    if (!rows.length) throw new NotFoundException('Reason not found');
    return rows[0];
  }

  async removeReason(id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .select({ id: reportReasons.id })
      .from(reportReasons)
      .where(eq(reportReasons.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Reason not found');
    await this.db.delete(reportReasons).where(eq(reportReasons.id, id));
    return { id };
  }

  // ── User reports ──────────────────────────────────────────
  async listUserReports(): Promise<
    Array<
      UserReportRow & {
        reporterName: string;
        targetName: string;
        reasonText: string | null;
        imageUrls: string[];
      }
    >
  > {
    const rows = await this.db
      .select({
        report: userReports,
        reason: reportReasons,
      })
      .from(userReports)
      .leftJoin(reportReasons, eq(reportReasons.id, userReports.reasonId))
      .orderBy(desc(userReports.createdAt));

    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.report.reporterId, r.report.targetUserId]),
      ),
    ];
    const allUsers =
      userIds.length > 0
        ? await this.db.select().from(users).where(inArray(users.id, userIds))
        : [];
    const nameMap = new Map(allUsers.map((u) => [u.id, nameOf(u)]));

    return rows.map((r) => ({
      ...r.report,
      reporterName: nameMap.get(r.report.reporterId) ?? '—',
      targetName: nameMap.get(r.report.targetUserId) ?? '—',
      reasonText: r.reason?.reason ?? null,
      // imagePaths are storage paths; the dashboard needs URLs to render.
      imageUrls: r.report.imagePaths.map((p) => this.files.publicUrlFor(p)),
    }));
  }

  /**
   * Approving a user report suspends the reported account, in the same
   * transaction and under the same account rules as editing it directly (a
   * plain admin cannot suspend staff). Moving an approved report back to
   * rejected/pending does NOT reinstate the account — that is an explicit
   * status change on the Users page.
   */
  async updateUserReportStatus(
    id: string,
    dto: UpdateReportStatusDto,
    reviewer: RequestUser,
  ) {
    return this.db.transaction(async (tx) => {
      const [report] = await tx
        .select()
        .from(userReports)
        .where(eq(userReports.id, id))
        .limit(1)
        .for('update');
      if (!report) throw new NotFoundException('User report not found');

      const [row] = await tx
        .update(userReports)
        .set({ status: dto.status, reviewedById: reviewer.id })
        .where(eq(userReports.id, id))
        .returning();

      if (dto.status === 'approved' && report.status !== 'approved') {
        await this.adminService.authorizeManage(
          tx,
          reviewer,
          report.targetUserId,
          { status: 'suspended' },
        );
        await tx
          .update(users)
          .set({ status: 'suspended', updatedAt: new Date() })
          .where(eq(users.id, report.targetUserId));

        // The ban is keyed on the number, not the account: it must outlive
        // the 90-day hard purge so the same numbers can never register again.
        const [target] = await tx
          .select({ primaryPhone: users.primaryPhone })
          .from(users)
          .where(eq(users.id, report.targetUserId))
          .limit(1);
        const extraPhones = await tx
          .select({ phone: userPhones.phone })
          .from(userPhones)
          .where(eq(userPhones.userId, report.targetUserId));

        const phones = [
          ...new Set(
            [target?.primaryPhone, ...extraPhones.map((p) => p.phone)]
              .filter(
                (phone): phone is string =>
                  typeof phone === 'string' && phone.length > 0,
              )
              .map(normalizePhoneE164),
          ),
        ];
        if (phones.length > 0) {
          await tx
            .insert(bannedPhones)
            .values(
              phones.map((phone) => ({
                phone,
                userId: report.targetUserId,
                reportId: report.id,
                bannedById: reviewer.id,
              })),
            )
            // A number already banned by an earlier report stays banned.
            .onConflictDoNothing({ target: bannedPhones.phone });
        }

        // Every other open report against this account is settled by the
        // same decision.
        await tx
          .update(userReports)
          .set({ status: 'approved', reviewedById: reviewer.id })
          .where(
            and(
              eq(userReports.targetUserId, report.targetUserId),
              eq(userReports.status, 'pending'),
            ),
          );
      }
      return row;
    });
  }

  async removeUserReport(id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .select({ id: userReports.id })
      .from(userReports)
      .where(eq(userReports.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('User report not found');
    await this.db.delete(userReports).where(eq(userReports.id, id));
    return { id };
  }

  // ── Listing reports ───────────────────────────────────────
  async listListingReports(): Promise<
    Array<
      ListingReportRow & {
        reporterName: string;
        listingTitle: string | null;
        reasonText: string | null;
      }
    >
  > {
    const rows = await this.db
      .select({
        report: listingReports,
        listing: listings,
        reason: reportReasons,
      })
      .from(listingReports)
      .leftJoin(listings, eq(listings.id, listingReports.listingId))
      .leftJoin(reportReasons, eq(reportReasons.id, listingReports.reasonId))
      .orderBy(desc(listingReports.createdAt));

    const reporterIds = [...new Set(rows.map((r) => r.report.reporterId))];
    const allUsers =
      reporterIds.length > 0
        ? await this.db
            .select()
            .from(users)
            .where(inArray(users.id, reporterIds))
        : [];
    const nameMap = new Map(allUsers.map((u) => [u.id, nameOf(u)]));

    return rows.map((r) => ({
      ...r.report,
      reporterName: nameMap.get(r.report.reporterId) ?? '—',
      listingTitle: r.listing?.title ?? null,
      reasonText: r.reason?.reason ?? null,
    }));
  }

  /**
   * Approving a listing report takes the listing down (ListingsService
   * .moderate) in the same transaction. As with user reports, un-approving
   * does not restore it — restoring is an explicit action on the admin
   * Listings page.
   */
  async updateListingReportStatus(
    id: string,
    dto: UpdateReportStatusDto,
    reviewer: RequestUser,
  ) {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ report: listingReports, reason: reportReasons.reason })
        .from(listingReports)
        .leftJoin(reportReasons, eq(reportReasons.id, listingReports.reasonId))
        .where(eq(listingReports.id, id))
        .limit(1)
        .for('update', { of: listingReports });
      if (!found) throw new NotFoundException('Listing report not found');
      const { report } = found;

      const [row] = await tx
        .update(listingReports)
        .set({ status: dto.status, reviewedById: reviewer.id })
        .where(eq(listingReports.id, id))
        .returning();

      if (dto.status === 'approved' && report.status !== 'approved') {
        await this.listingsService.moderate(
          report.listingId,
          reviewer.id,
          found.reason ? `Reported: ${found.reason}` : 'Reported content',
          tx,
        );
        await tx
          .update(listingReports)
          .set({ status: 'approved', reviewedById: reviewer.id })
          .where(
            and(
              eq(listingReports.listingId, report.listingId),
              eq(listingReports.status, 'pending'),
            ),
          );
      }
      return row;
    });
  }

  async removeListingReport(id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .select({ id: listingReports.id })
      .from(listingReports)
      .where(eq(listingReports.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Listing report not found');
    await this.db.delete(listingReports).where(eq(listingReports.id, id));
    return { id };
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
