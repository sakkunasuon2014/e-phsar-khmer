import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import { jobApplications } from '../db/schema/applications.schema';
import type { JobApplicationRow } from '../db/schema/applications.schema';
import { categories } from '../db/schema/categories.schema';
import { listingPhotos, listings } from '../db/schema/listings.schema';
import { users } from '../db/schema/users.schema';
import { ChatService } from '../chat/chat.service';
import type { ChatUserSummary } from '../chat/chat.types';
import { isBlockedEitherWay } from '../chat/blocks.util';
import { NotificationsService } from '../notifications/notifications.service';
import { ResumeService } from '../resume/resume.service';
import { ResumeAttachmentsService } from '../resume/resume-attachments.service';
import type { ResumeAttachmentDownloadUrl } from '../resume/resume-attachments.service';
import type { PaginatedResponse } from '../common/types/api-response.types';
import type { CreateApplicationDto } from './dto/create-application.dto';
import type { ListApplicationsDto } from './dto/list-applications.dto';
import type { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import type {
  ApplicationDetail,
  ApplicationListing,
  ApplicationResumeSummary,
  AppliedJobView,
  ApplyResultView,
  JobApplicationStatus,
  ReceivedApplicationView,
} from './applications.types';

/** The only category whose listings can be applied to. */
const JOB_CATEGORY_SLUG = 'jobs';

/** How much of a cover note / résumé summary a list row or notification carries. */
const SNIPPET_MAX = 160;

/**
 * Job applications — the durable record behind "Apply For This Job", and the
 * one path by which a résumé reaches another account.
 *
 * The delivery channel is chat: `ChatService.sendMessage` is the single chat
 * write path, and this module calls it in-process rather than opening a second
 * one. The message is encrypted in the applicant's browser (the server holds
 * no keys), sent **before** the row is inserted, with a deterministic
 * `clientMessageId`, so the two-step write self-heals — see `apply` for why
 * that order and what each failure leaves behind. When the poster has no
 * encrypted-chat devices there is no one to encrypt to, so the application is
 * recorded without a chat message and the notification is the only delivery.
 *
 * The résumé is frozen into the row at apply time (`resumeSnapshot`). Nothing
 * here ever reads the applicant's live résumé after that, which is what keeps
 * the resume module's owner-only rule intact: the poster sees one application's
 * blob, never `resumes`.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly chat: ChatService,
    private readonly notifications: NotificationsService,
    private readonly resume: ResumeService,
    private readonly resumeAttachments: ResumeAttachmentsService,
  ) {}

  /**
   * Apply to a job.
   *
   * Rejections come first and in full: an application is a durable row *and* a
   * chat message, so there is no state worth writing for a job that is closed,
   * someone's own, or addressed to a poster who cannot be messaged.
   *
   * Order of the two writes is the failure policy. The chat message goes first,
   * idempotently (`clientMessageId` is derived from the pair, so a retry
   * replays the original message instead of sending a second one); the row is
   * inserted second, after the send succeeded. That way a failed send leaves
   * nothing on the seeker's list to lie about, and the one case that is not
   * atomic — the send succeeding and the insert failing — resolves on retry:
   * the chat replays, the insert lands. No transaction spans the two because
   * `ChatService` writes on the shared client and cannot enlist; this is the
   * same honest non-transactionality `follow.created` carries.
   *
   * New messages must be encrypted, so `body` is ciphertext and the E2E
   * payload comes from the applicant's browser. A half-specified payload is a
   * 400 here rather than a chat-side error, and a plaintext-only body can
   * never reach the database. When the poster has no devices to encrypt to,
   * the client omits the payload: the application is still recorded, the
   * block check runs here (the chat path is what normally enforces it), and
   * `chat` comes back null.
   */
  async apply(
    applicantId: string,
    listingId: string,
    dto: CreateApplicationDto,
  ): Promise<ApplyResultView> {
    const job = await this.loadJob(listingId);
    if (!job) throw new NotFoundException('Listing not found');
    if (job.categorySlug !== JOB_CATEGORY_SLUG)
      throw new BadRequestException('Not a job listing');
    if (job.posterId === applicantId)
      throw new BadRequestException('Cannot apply to your own job');
    // The listing page only offers the button on an active job, so this is a
    // stale tab or a direct call — say so rather than quietly storing it.
    if (job.status !== 'active')
      throw new BadRequestException(
        'This job is no longer accepting applications',
      );
    if (job.posterDeletedAt)
      throw new NotFoundException('Job poster not found');

    const existing = await this.findByPair(listingId, applicantId);
    if (existing)
      throw new ConflictException({
        code: 'JOB_APPLICATION_EXISTS',
        message: 'Already applied to this listing',
        details: { applicationId: existing.id },
      });

    const coverNote = dto.coverNote?.trim() ? dto.coverNote.trim() : null;
    const encrypted = Boolean(dto.e2e || dto.e2eHeader);

    // Both-or-neither: a body with no E2E payload would be a plaintext chat
    // row (the chat path refuses it anyway — say so here with a clear 400),
    // and an E2E payload with no body carries nothing to decrypt.
    if (encrypted && !dto.body)
      throw new BadRequestException(
        'An encrypted application message must carry a body',
      );
    if (dto.body && !encrypted)
      throw new BadRequestException('Application messages must be encrypted');

    // Without a chat send there is no ChatService call to enforce blocks, and
    // a blocked pair must not be able to apply by omitting the payload.
    if (
      !encrypted &&
      (await isBlockedEitherWay(this.db, applicantId, job.posterId))
    )
      throw new ForbiddenException('Messaging unavailable');

    // The message first (see the note above). A block in either direction
    // surfaces here as the chat path's own 403 and nothing is written.
    let chat: ApplyResultView['chat'] = null;
    if (encrypted) {
      const sent = await this.chat.sendMessage(applicantId, {
        recipientId: job.posterId,
        listingId,
        body: dto.body,
        ...(dto.e2e ? { e2e: dto.e2e } : {}),
        ...(dto.e2eHeader
          ? {
              e2eHeader: dto.e2eHeader,
              ...(dto.recipientIdentityKey
                ? { recipientIdentityKey: dto.recipientIdentityKey }
                : {}),
            }
          : {}),
        clientMessageId: applicationDedupKey(listingId, applicantId),
      });
      chat = { conversationId: sent.conversationId, message: sent.message };
    }

    const snapshot = await this.loadResumeSnapshot(applicantId);

    // The unique index is the real guard: two concurrent applies both reach
    // this insert, the loser gets no row back and answers 409 — and because
    // both sent the same `clientMessageId`, the loser's send was a replay, not
    // a second message.
    const [row] = await this.db
      .insert(jobApplications)
      .values({
        listingId,
        applicantId,
        posterId: job.posterId,
        coverNote,
        resumeSnapshot: snapshot,
      })
      .onConflictDoNothing({
        target: [jobApplications.listingId, jobApplications.applicantId],
      })
      .returning();

    if (!row) {
      const raced = await this.findByPair(listingId, applicantId);
      throw new ConflictException({
        code: 'JOB_APPLICATION_EXISTS',
        message: 'Already applied to this listing',
        details: { applicationId: raced?.id ?? null },
      });
    }

    // Gated on the row we actually inserted, the `follow.created` rule: a
    // replayed apply can never double-notify the poster.
    await this.notifyPoster(job, row, applicantId);

    const [posters, contexts] = await Promise.all([
      this.loadSummaries([job.posterId]),
      this.loadListingContexts([job]),
    ]);
    return {
      id: row.id,
      status: row.status,
      coverNote: row.coverNote,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      listing: contexts.get(job.id) ?? unavailableListing(job.id),
      poster: posters.get(job.posterId) ?? unknownUser(job.posterId),
      chat,
    };
  }

  /** `/me/applied-jobs`: the jobs this account applied to, newest first. */
  async listMine(
    userId: string,
    query: ListApplicationsDto,
  ): Promise<PaginatedResponse<AppliedJobView>> {
    const { page, pageSize, offset } = paginate(query);

    const where = and(
      eq(jobApplications.applicantId, userId),
      query.status ? eq(jobApplications.status, query.status) : undefined,
      query.listingId
        ? eq(jobApplications.listingId, query.listingId)
        : undefined,
    );

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({ application: jobApplications, job: jobColumns })
        .from(jobApplications)
        .innerJoin(listings, eq(listings.id, jobApplications.listingId))
        .where(where)
        .orderBy(desc(jobApplications.createdAt), desc(jobApplications.id))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(jobApplications)
        .innerJoin(listings, eq(listings.id, jobApplications.listingId))
        .where(where),
    ]);

    // Deliberately no `status != 'deleted'` filter, unlike the likes/saves
    // lists: an application is a record of something the seeker did, and the
    // job going away must not erase it — the row renders a tombstone instead.
    const contexts = await this.loadListingContexts(rows.map((r) => r.job));
    const posters = await this.loadSummaries(
      rows.map((r) => r.application.posterId),
    );

    return {
      data: rows.map(({ application, job }) => ({
        id: application.id,
        status: application.status,
        coverNote: application.coverNote,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        listing: contexts.get(job.id) ?? unavailableListing(job.id),
        poster:
          posters.get(application.posterId) ??
          unknownUser(application.posterId),
      })),
      meta: meta(page, pageSize, offset, rows.length, totalRow.value),
    };
  }

  /** `/me/job-applications`: applications to this account's listings. */
  async listReceived(
    userId: string,
    query: ListApplicationsDto,
  ): Promise<PaginatedResponse<ReceivedApplicationView>> {
    const { page, pageSize, offset } = paginate(query);

    const where = and(
      eq(jobApplications.posterId, userId),
      query.status ? eq(jobApplications.status, query.status) : undefined,
      query.listingId
        ? eq(jobApplications.listingId, query.listingId)
        : undefined,
    );

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({ application: jobApplications, job: jobColumns })
        .from(jobApplications)
        .innerJoin(listings, eq(listings.id, jobApplications.listingId))
        .where(where)
        .orderBy(desc(jobApplications.createdAt), desc(jobApplications.id))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(jobApplications)
        .innerJoin(listings, eq(listings.id, jobApplications.listingId))
        .where(where),
    ]);

    const contexts = await this.loadListingContexts(rows.map((r) => r.job));
    const applicants = await this.loadSummaries(
      rows.map((r) => r.application.applicantId),
    );

    return {
      data: rows.map(({ application, job }) => ({
        id: application.id,
        status: application.status,
        coverNote: application.coverNote,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        viewedAt: application.viewedAt,
        decidedAt: application.decidedAt,
        listing: contexts.get(job.id) ?? unavailableListing(job.id),
        applicant:
          applicants.get(application.applicantId) ??
          unknownUser(application.applicantId),
        resume: toResumeSummary(application),
      })),
      meta: meta(page, pageSize, offset, rows.length, totalRow.value),
    };
  }

  /**
   * One application in full — either party may read it, nobody else (404, not
   * 403: the same no-existence-oracle rule the chat routes keep).
   *
   * The poster's first read is what "viewed" means, so it flips `pending` here.
   * The update is conditioned on the row still being pending, so it can never
   * clobber a decision made in another tab; the applicant opening their own
   * application flips nothing.
   */
  async getOne(userId: string, id: string): Promise<ApplicationDetail> {
    let row = await this.findForViewer(userId, id);

    if (row.posterId === userId && row.status === 'pending') {
      const [flipped] = await this.db
        .update(jobApplications)
        .set({ status: 'viewed', viewedAt: sql`now()` })
        .where(
          and(
            eq(jobApplications.id, id),
            eq(jobApplications.status, 'pending'),
          ),
        )
        .returning();
      if (flipped) row = flipped;
    }

    const [job] = await this.db
      .select(jobColumns)
      .from(listings)
      .where(eq(listings.id, row.listingId))
      .limit(1);
    const contexts = await this.loadListingContexts(job ? [job] : []);
    const summaries = await this.loadSummaries([row.applicantId, row.posterId]);

    return {
      id: row.id,
      status: row.status,
      coverNote: row.coverNote,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      viewedAt: row.viewedAt,
      decidedAt: row.decidedAt,
      listing:
        (job ? contexts.get(job.id) : undefined) ??
        unavailableListing(row.listingId),
      applicant: summaries.get(row.applicantId) ?? unknownUser(row.applicantId),
      poster: summaries.get(row.posterId) ?? unknownUser(row.posterId),
      resume: row.resumeSnapshot ?? null,
    };
  }

  /** The poster's verdict. Only the poster; only forward states. */
  async setStatus(
    userId: string,
    id: string,
    dto: UpdateApplicationStatusDto,
  ): Promise<{ id: string; status: JobApplicationStatus }> {
    const row = await this.findForViewer(userId, id);
    if (row.posterId !== userId) throw applicationNotFound(id);

    const [updated] = await this.db
      .update(jobApplications)
      .set({
        status: dto.status,
        ...(dto.status === 'viewed'
          ? { viewedAt: sql`now()` }
          : { decidedAt: sql`now()` }),
      })
      .where(eq(jobApplications.id, id))
      .returning({ id: jobApplications.id, status: jobApplications.status });

    return updated;
  }

  /**
   * A short-lived download URL for the CV this application carried.
   *
   * The allow-list is the poster, and only the poster: the applicant's own CV
   * is at `/me/resume`, so routing them here would only widen the rule. The
   * file is never copied — the snapshot carries its id, and an id that no
   * longer resolves (the applicant removed or replaced it) is the honest
   * `409` the UI renders as "CV no longer available".
   */
  async signCv(
    userId: string,
    id: string,
  ): Promise<ResumeAttachmentDownloadUrl> {
    const row = await this.findForViewer(userId, id);
    if (row.posterId !== userId) throw applicationNotFound(id);

    const attachmentId = row.resumeSnapshot?.attachment?.id;
    if (!attachmentId)
      throw new ConflictException({
        code: 'RESUME_CV_MISSING',
        message: 'This application carried no CV file',
      });

    const signed =
      await this.resumeAttachments.signAttachmentById(attachmentId);
    if (!signed)
      throw new ConflictException({
        code: 'RESUME_CV_REMOVED',
        message: 'The applicant removed this CV file',
      });
    return signed;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async findByPair(
    listingId: string,
    applicantId: string,
  ): Promise<JobApplicationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(jobApplications)
      .where(
        and(
          eq(jobApplications.listingId, listingId),
          eq(jobApplications.applicantId, applicantId),
        ),
      )
      .limit(1);
    return row;
  }

  /** 404 — not 403 — for a non-participant: no existence oracle. */
  private async findForViewer(
    userId: string,
    id: string,
  ): Promise<JobApplicationRow> {
    const [row] = await this.db
      .select()
      .from(jobApplications)
      .where(eq(jobApplications.id, id))
      .limit(1);
    if (!row || (row.applicantId !== userId && row.posterId !== userId))
      throw applicationNotFound(id);
    return row;
  }

  /**
   * The job side of the apply checks: owner, status, category, title. One
   * query, no photos — a rejected apply never needs the card, and the checks
   * below are the common case on a stale page.
   */
  private async loadJob(listingId: string): Promise<JobFacts | undefined> {
    const [row] = await this.db
      .select({
        ...jobColumns,
        posterId: listings.userId,
        categorySlug: categories.slug,
        posterDeletedAt: users.deletedAt,
      })
      .from(listings)
      .innerJoin(categories, eq(categories.id, listings.categoryId))
      .innerJoin(users, eq(users.id, listings.userId))
      .where(eq(listings.id, listingId))
      .limit(1);
    return row;
  }

  /** The applicant's résumé as it stands right now — or null when they have none. */
  private async loadResumeSnapshot(applicantId: string) {
    const document = await this.resume.getDocument(applicantId);
    return document.exists ? document : null;
  }

  private async notifyPoster(
    job: JobFacts,
    row: JobApplicationRow,
    applicantId: string,
  ): Promise<void> {
    const name = await this.loadDisplayName(applicantId);
    const title = `${name} applied for ${job.title}`;

    await this.notifications.notify({
      userId: job.posterId,
      type: 'application.created',
      title: title.length > 200 ? `${title.slice(0, 197)}...` : title,
      body: row.coverNote ? snippet(row.coverNote) : undefined,
      data: {
        applicationId: row.id,
        listingId: row.listingId,
        applicantId,
      },
    });
  }

  /** The applicant's own name for the notification line — `follow.created`'s lookup. */
  private async loadDisplayName(userId: string): Promise<string> {
    const [row] = await this.db
      .select({
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return (
      [row?.firstName, row?.lastName].filter(Boolean).join(' ').trim() ||
      row?.username ||
      'Someone'
    );
  }

  /** Identity for the rows that print a person: one query per page. */
  private async loadSummaries(
    ids: string[],
  ): Promise<Map<string, ChatUserSummary>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        profilePhotoUrl: users.profilePhotoUrl,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(inArray(users.id, unique));

    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * The card data for a page of jobs: one query for the photos of every
   * listing on the page (never per row), assembled here. A listing whose row
   * has since been hard-deleted is simply absent from the map and the caller
   * falls back to a tombstone.
   */
  private async loadListingContexts(
    rows: JobRow[],
  ): Promise<Map<string, ApplicationListing>> {
    if (rows.length === 0) return new Map();

    const photos = await this.db
      .select({
        listingId: listingPhotos.listingId,
        url: listingPhotos.url,
        sort: listingPhotos.sort,
      })
      .from(listingPhotos)
      .where(
        inArray(
          listingPhotos.listingId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(listingPhotos.sort);

    const first = new Map<string, string>();
    for (const photo of photos)
      if (!first.has(photo.listingId)) first.set(photo.listingId, photo.url);

    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          title: row.title,
          price: row.price,
          currency: row.currency,
          status: row.status,
          thumbnailUrl: first.get(row.id) ?? null,
          company: row.company,
        },
      ]),
    );
  }
}

/** The columns every read needs to build a listing card. */
const jobColumns = {
  id: listings.id,
  title: listings.title,
  price: listings.price,
  currency: listings.currency,
  status: listings.status,
  company: sql<string | null>`${listings.attributes}->>'company'`,
};

type JobRow = {
  id: string;
  title: string;
  price: string | null;
  currency: string;
  status: 'draft' | 'active' | 'expired' | 'deleted' | 'restricted';
  company: string | null;
};

type JobFacts = JobRow & {
  posterId: string;
  categorySlug: string;
  posterDeletedAt: Date | null;
};

/**
 * Chat's dedup key for an application. Derived from the pair, not the row id,
 * so a retry *before* the row exists still replays instead of double-sending.
 */
function applicationDedupKey(listingId: string, applicantId: string): string {
  return `apply:${listingId}:${applicantId}`;
}

function toResumeSummary(row: JobApplicationRow): ApplicationResumeSummary {
  const snapshot = row.resumeSnapshot;
  const attachment = snapshot?.attachment ?? null;
  return {
    hasResume: snapshot !== null,
    summary: snapshot?.summary?.trim() ? snippet(snapshot.summary) : null,
    cv: attachment
      ? { fileName: attachment.fileName, size: attachment.size }
      : null,
  };
}

function snippet(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > SNIPPET_MAX
    ? `${trimmed.slice(0, SNIPPET_MAX - 3)}...`
    : trimmed;
}

/** A user row that no longer exists still has to render as something. */
function unknownUser(id: string): ChatUserSummary {
  return { id, username: null, profilePhotoUrl: null, lastSeenAt: null };
}

/** A job whose listing row is gone (hard-deleted): the row still renders. */
function unavailableListing(id: string): ApplicationListing {
  return {
    id,
    title: '',
    price: null,
    currency: 'USD',
    status: 'deleted',
    thumbnailUrl: null,
    company: null,
  };
}

function applicationNotFound(id: string): NotFoundException {
  return new NotFoundException(`Application ${id} not found`);
}

function paginate(query: ListApplicationsDto): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function meta(
  page: number,
  pageSize: number,
  offset: number,
  rowCount: number,
  total: number,
) {
  return {
    nextCursor: null,
    hasMore: offset + rowCount < total,
    limit: pageSize,
    total,
    page,
    pageSize,
  };
}
