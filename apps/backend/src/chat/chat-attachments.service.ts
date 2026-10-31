import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient, DbExecutor } from '../db/drizzle.provider';
import {
  chatAttachments,
  conversations,
  messages,
} from '../db/schema/chat.schema';
import type { ChatAttachmentRow } from '../db/schema/chat.schema';
import { SupabaseService } from '../common/supabase/supabase.service';
import {
  ATTACHMENT_DOWNLOAD_TTL_SECONDS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_ORPHAN_AGE_HOURS,
  ATTACHMENT_UPLOAD_TTL_SECONDS,
} from './chat-attachments.constants';
import type { AttachmentKind } from './chat-attachments.constants';
import type { CreateAttachmentDto } from './dto/attachments.dto';
import type { MessageAttachmentView } from './chat.types';

export interface AttachmentUploadTicket {
  id: string;
  uploadUrl: string;
  token: string;
  expiresIn: number;
}

export interface AttachmentDownloadUrl {
  id: string;
  url: string;
  expiresAt: string;
}

/**
 * Lifecycle of end-to-end encrypted chat files: create (issue an upload URL)
 * → complete (verify the object really exists and its real size) → attach
 * (inside ChatService's send transaction) → signed download URLs for
 * participants only → cleanup of anything never attached.
 *
 * The server only ever handles ciphertext. Keys, MIME types, names and the
 * ciphertext hash live in the E2E message; the recipient verifies integrity.
 * See docs/e2e-attachments.md.
 */
@Injectable()
export class ChatAttachmentsService {
  private readonly logger = new Logger(ChatAttachmentsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  private get bucket(): string {
    return this.config.get<string>('chat.filesBucket') ?? 'chat-files';
  }

  private get dailyBytes(): number {
    return this.config.get<number>('chat.attachmentDailyBytes') ?? 209_715_200;
  }

  async create(
    userId: string,
    dto: CreateAttachmentDto,
  ): Promise<AttachmentUploadTicket> {
    if (dto.declaredSize > ATTACHMENT_MAX_BYTES[dto.kind])
      throw tooLarge(dto.kind);

    const existing = await this.findById(dto.id);
    if (existing) return this.reissue(userId, existing);

    await this.assertQuota(userId, dto.declaredSize);

    const [row] = await this.db
      .insert(chatAttachments)
      .values({
        id: dto.id,
        uploaderId: userId,
        objectKey: `${userId}/${dto.id}`,
        kind: dto.kind,
        declaredSize: dto.declaredSize,
      })
      .onConflictDoNothing()
      .returning();
    // Lost a race with a concurrent create of the same id — treat it as the
    // retry it almost certainly is.
    if (!row) {
      const raced = await this.findById(dto.id);
      if (!raced) throw new ConflictException('Attachment create conflict');
      return this.reissue(userId, raced);
    }
    return this.issueUploadUrl(row);
  }

  async complete(
    userId: string,
    id: string,
  ): Promise<{ id: string; status: 'uploaded'; actualSize: number }> {
    const row = await this.findOwned(userId, id);
    if (row.status === 'uploaded' || row.status === 'attached')
      return { id, status: 'uploaded', actualSize: row.actualSize ?? 0 };
    if (row.status === 'expired')
      throw new ConflictException({
        code: 'ATTACHMENT_EXPIRED',
        message: 'Attachment expired',
      });

    const { data } = await this.supabase.objectInfo(this.bucket, row.objectKey);
    const size = data?.size;
    if (typeof size !== 'number')
      throw new ConflictException({
        code: 'ATTACHMENT_NOT_UPLOADED',
        message: 'The file has not been uploaded yet',
      });

    const kind = row.kind as AttachmentKind;
    if (size > ATTACHMENT_MAX_BYTES[kind]) {
      await this.supabase.removeObjects(this.bucket, [row.objectKey]);
      await this.db
        .update(chatAttachments)
        .set({ status: 'expired', actualSize: size })
        .where(eq(chatAttachments.id, id));
      throw tooLarge(kind);
    }

    const [updated] = await this.db
      .update(chatAttachments)
      .set({ status: 'uploaded', actualSize: size, uploadedAt: sql`now()` })
      .where(
        and(eq(chatAttachments.id, id), eq(chatAttachments.status, 'pending')),
      )
      .returning({ actualSize: chatAttachments.actualSize });
    return { id, status: 'uploaded', actualSize: updated?.actualSize ?? size };
  }

  /**
   * Binds uploaded attachments to a just-inserted message. Must run inside
   * the send transaction: one conditional UPDATE, so under concurrency a file
   * can only ever attach to one message, only its uploader's, and only once
   * its upload was verified. A short count throws and rolls the message back.
   */
  async attachToMessage(
    tx: DbExecutor,
    senderId: string,
    messageId: string,
    ids: string[],
  ): Promise<MessageAttachmentView[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .update(chatAttachments)
      .set({ status: 'attached', messageId, attachedAt: sql`now()` })
      .where(
        and(
          inArray(chatAttachments.id, ids),
          eq(chatAttachments.uploaderId, senderId),
          eq(chatAttachments.status, 'uploaded'),
          isNull(chatAttachments.messageId),
        ),
      )
      .returning({ id: chatAttachments.id, kind: chatAttachments.kind });
    if (rows.length !== ids.length) {
      const ok = new Set(rows.map((r) => r.id));
      throw new BadRequestException({
        code: 'ATTACHMENT_INVALID',
        message: 'One or more attachments cannot be used',
        details: { invalid: ids.filter((id) => !ok.has(id)) },
      });
    }
    // Keep the caller's order — it is the order the sender arranged them in.
    const kinds = new Map(rows.map((r) => [r.id, r.kind]));
    return ids.map((id) => ({ id, kind: kinds.get(id) as AttachmentKind }));
  }

  /** `{id, kind}` per message, in upload order, for any batch of messages. */
  async loadForMessages(
    messageIds: string[],
  ): Promise<Map<string, MessageAttachmentView[]>> {
    const byMessage = new Map<string, MessageAttachmentView[]>();
    if (messageIds.length === 0) return byMessage;
    const rows = await this.db
      .select({
        id: chatAttachments.id,
        kind: chatAttachments.kind,
        messageId: chatAttachments.messageId,
      })
      .from(chatAttachments)
      .where(inArray(chatAttachments.messageId, messageIds))
      .orderBy(chatAttachments.createdAt, chatAttachments.id);
    for (const r of rows) {
      if (!r.messageId) continue;
      const list = byMessage.get(r.messageId) ?? [];
      list.push({ id: r.id, kind: r.kind as AttachmentKind });
      byMessage.set(r.messageId, list);
    }
    return byMessage;
  }

  /**
   * Short-lived download URLs, only for attached files in conversations the
   * caller takes part in. Ids that don't qualify are silently left out — no
   * existence oracle, same as the 404-for-non-participants rule.
   */
  async sign(userId: string, ids: string[]): Promise<AttachmentDownloadUrl[]> {
    const rows = await this.db
      .select({ id: chatAttachments.id, objectKey: chatAttachments.objectKey })
      .from(chatAttachments)
      .innerJoin(messages, eq(messages.id, chatAttachments.messageId))
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          inArray(chatAttachments.id, ids),
          eq(chatAttachments.status, 'attached'),
          or(
            eq(conversations.userAId, userId),
            eq(conversations.userBId, userId),
          ),
        ),
      );
    if (rows.length === 0) return [];

    const { data, error } = await this.supabase.createSignedUrls(
      this.bucket,
      rows.map((r) => r.objectKey),
      ATTACHMENT_DOWNLOAD_TTL_SECONDS,
    );
    if (error || !data) {
      this.logger.warn(`Failed to sign ${rows.length} attachment URL(s)`);
      throw new HttpException(
        { code: 'ATTACHMENT_SIGN_FAILED', message: 'Could not sign URLs' },
        HttpStatus.BAD_GATEWAY,
      );
    }
    const urlByKey = new Map(
      data
        .filter((d) => d.path && d.signedUrl)
        .map((d) => [d.path as string, d.signedUrl as string]),
    );
    const expiresAt = new Date(
      Date.now() + ATTACHMENT_DOWNLOAD_TTL_SECONDS * 1000,
    ).toISOString();
    return rows.flatMap((r) => {
      const url = urlByKey.get(r.objectKey);
      return url ? [{ id: r.id, url, expiresAt }] : [];
    });
  }

  /**
   * Removes storage objects, then rows, for uploads never attached within
   * the orphan window, plus attached files whose message is gone (message_id
   * set null by the FK). Safe to rerun: removing a missing object is a no-op.
   * Returns how many rows were removed.
   */
  async cleanupOrphans(batchSize = 100): Promise<number> {
    const rows = await this.db
      .select({ id: chatAttachments.id, objectKey: chatAttachments.objectKey })
      .from(chatAttachments)
      .where(
        and(
          isNull(chatAttachments.messageId),
          or(
            and(
              ne(chatAttachments.status, 'attached'),
              sql`${chatAttachments.createdAt} < now() - make_interval(hours => ${ATTACHMENT_ORPHAN_AGE_HOURS})`,
            ),
            eq(chatAttachments.status, 'attached'),
          ),
        ),
      )
      .limit(batchSize);
    if (rows.length === 0) return 0;

    const { error } = await this.supabase.removeObjects(
      this.bucket,
      rows.map((r) => r.objectKey),
    );
    // Keep the rows when storage refused: deleting them would orphan the
    // objects for good. The next run retries.
    if (error) {
      this.logger.warn(`Attachment cleanup: storage remove failed`);
      return 0;
    }
    await this.db.delete(chatAttachments).where(
      inArray(
        chatAttachments.id,
        rows.map((r) => r.id),
      ),
    );
    return rows.length;
  }

  private async findById(id: string): Promise<ChatAttachmentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(chatAttachments)
      .where(eq(chatAttachments.id, id))
      .limit(1);
    return row;
  }

  private async findOwned(
    userId: string,
    id: string,
  ): Promise<ChatAttachmentRow> {
    const row = await this.findById(id);
    if (!row || row.uploaderId !== userId)
      throw new NotFoundException('Attachment not found');
    return row;
  }

  /** Idempotent create: same uploader + still pending → a fresh upload URL. */
  private reissue(
    userId: string,
    row: ChatAttachmentRow,
  ): Promise<AttachmentUploadTicket> {
    if (row.uploaderId !== userId)
      throw new ConflictException({
        code: 'ATTACHMENT_ID_TAKEN',
        message: 'Attachment id already in use',
      });
    if (row.status !== 'pending')
      throw new ConflictException({
        code: 'ATTACHMENT_NOT_PENDING',
        message: 'Attachment already uploaded',
        details: { status: row.status },
      });
    return this.issueUploadUrl(row);
  }

  private async issueUploadUrl(
    row: ChatAttachmentRow,
  ): Promise<AttachmentUploadTicket> {
    // upsert: a retry after an upload whose response was lost must be able
    // to write the same object again.
    const { data, error } = await this.supabase.createSignedUploadUrl(
      this.bucket,
      row.objectKey,
      { upsert: true },
    );
    if (error || !data)
      throw new HttpException(
        { code: 'ATTACHMENT_SIGN_FAILED', message: 'Could not sign upload' },
        HttpStatus.BAD_GATEWAY,
      );
    return {
      id: row.id,
      uploadUrl: data.signedUrl,
      token: data.token,
      expiresIn: ATTACHMENT_UPLOAD_TTL_SECONDS,
    };
  }

  private async assertQuota(userId: string, adding: number): Promise<void> {
    const [row] = await this.db
      .select({
        used: sql<number>`coalesce(sum(${chatAttachments.declaredSize}), 0)::bigint`,
      })
      .from(chatAttachments)
      .where(
        and(
          eq(chatAttachments.uploaderId, userId),
          gt(chatAttachments.createdAt, sql`now() - interval '24 hours'`),
        ),
      );
    if (Number(row?.used ?? 0) + adding > this.dailyBytes)
      throw new HttpException(
        {
          code: 'ATTACHMENT_QUOTA_EXCEEDED',
          message: 'Daily upload limit reached',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}

function tooLarge(kind: AttachmentKind): BadRequestException {
  return new BadRequestException({
    code: 'ATTACHMENT_TOO_LARGE',
    message: `File exceeds the ${ATTACHMENT_MAX_BYTES[kind] / 1024 / 1024} MB limit`,
  });
}
