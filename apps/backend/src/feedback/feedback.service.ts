import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import { feedback } from '../db/schema/feedback.schema';
import type { FeedbackRow } from '../db/schema/feedback.schema';
import { users } from '../db/schema/users.schema';
import type { PaginatedResponse } from '../common/types/api-response.types';
import { FilesService } from '../files/files.service';
import { likeTerm } from '../utils/like-term';
import type { CreateFeedbackDto, ListFeedbackDto } from './dto/feedback.dto';

export const FEEDBACK_MAX_IMAGES = 6;

export interface FeedbackView extends Omit<FeedbackRow, 'imagePaths'> {
  images: string[];
}

@Injectable()
export class FeedbackService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly files: FilesService,
  ) {}

  /**
   * Images are uploaded server-side (validated type + size by FilesService),
   * so an anonymous visitor never needs a signed-upload grant. They are
   * uploaded before the row is written; if the insert fails they are removed
   * again so a rejected submission leaves no orphans.
   */
  async create(
    dto: CreateFeedbackDto,
    images: Express.Multer.File[],
    userId: string | null,
  ): Promise<{ id: string }> {
    const bucket = this.files.getDefaultBucket();
    const uploaded: string[] = [];
    try {
      for (const file of images.slice(0, FEEDBACK_MAX_IMAGES)) {
        const { path } = await this.files.uploadPublic(
          bucket,
          'feedback',
          file,
        );
        uploaded.push(path);
      }

      const linkedUserId = userId ? await this.activeUserId(userId) : null;
      const [row] = await this.db
        .insert(feedback)
        .values({
          userId: linkedUserId,
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          email: dto.email?.trim() || null,
          description: dto.description.trim(),
          imagePaths: uploaded,
        })
        .returning({ id: feedback.id });
      return row;
    } catch (err) {
      await this.files.remove(bucket, uploaded);
      throw err;
    }
  }

  async list(dto: ListFeedbackDto): Promise<PaginatedResponse<FeedbackView>> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 50;
    const offset = (page - 1) * pageSize;
    const where = dto.q
      ? or(
          ilike(feedback.name, likeTerm(dto.q)),
          ilike(feedback.phone, likeTerm(dto.q)),
          ilike(feedback.email, likeTerm(dto.q)),
          ilike(feedback.description, likeTerm(dto.q)),
        )
      : undefined;

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(feedback)
        .where(where)
        .orderBy(desc(feedback.createdAt), desc(feedback.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ value: count() }).from(feedback).where(where),
    ]);

    const total = totalRow.value;
    return {
      data: rows.map(({ imagePaths, ...rest }) => ({
        ...rest,
        images: imagePaths.map((p) => this.files.publicUrlFor(p)),
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

  async remove(id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .delete(feedback)
      .where(eq(feedback.id, id))
      .returning({ imagePaths: feedback.imagePaths });
    if (!row) throw new NotFoundException('Feedback not found');
    // After the delete commits; FilesService.remove logs, never throws.
    await this.files.remove(this.files.getDefaultBucket(), row.imagePaths);
    return { id };
  }

  /** The token's user, if still an active account — else submit anonymously. */
  private async activeUserId(userId: string): Promise<string | null> {
    const [u] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return u?.id ?? null;
  }
}
