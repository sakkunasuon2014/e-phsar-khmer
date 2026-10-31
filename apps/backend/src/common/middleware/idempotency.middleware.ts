import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { DRIZZLE } from '../../db/drizzle.provider';
import type { DbClient } from '../../db/drizzle.provider';
import { idempotencyKeys } from '../../db/schema/idempotency.schema';

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  // Middleware runs before guards, so req.user is not populated yet;
  // verify the bearer token directly to scope idempotency keys per user.
  private extractUserId(req: Request): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    try {
      const payload = this.jwtService.verify<{ sub?: string }>(auth.slice(7));
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      next();
      return;
    }

    if (!idempotencyKey.trim()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key header must not be empty',
        },
      });
      return;
    }

    const method = req.method.toUpperCase();
    const path = req.path;
    const userId = this.extractUserId(req);
    const userScope = userId
      ? eq(idempotencyKeys.userId, userId)
      : isNull(idempotencyKeys.userId);
    const requestHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');

    const ttlHours =
      this.configService.get<number>('idempotency.ttlHours') ?? 24;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    await this.db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, idempotencyKey),
          eq(idempotencyKeys.method, method),
          eq(idempotencyKeys.path, path),
          userScope,
          lt(idempotencyKeys.expiresAt, now),
        ),
      );

    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({
        key: idempotencyKey,
        userId,
        method,
        path,
        requestHash,
        status: 'processing',
        expiresAt,
        createdAt: now,
        lockedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    let rowId: string;

    if (inserted.length > 0) {
      // We created the row — first request for this key, let it through
      rowId = inserted[0].id;
    } else {
      const [existing] = await this.db
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.key, idempotencyKey),
            eq(idempotencyKeys.method, method),
            eq(idempotencyKeys.path, path),
            userScope,
            gt(idempotencyKeys.expiresAt, now),
          ),
        )
        .limit(1);

      if (!existing) {
        next();
        return;
      }

      // A key belongs to exactly one request body, whatever state it is in.
      // (A null hash is a pre-hash legacy row: treated as matching.)
      if (existing.requestHash && existing.requestHash !== requestHash) {
        res.status(422).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSE',
            message: 'Idempotency key used with different request body',
          },
        });
        return;
      }

      if (existing.status === 'completed') {
        res.status(existing.responseStatus ?? 200).json(existing.responseBody);
        return;
      }

      if (existing.status === 'processing') {
        const ageMs = now.getTime() - new Date(existing.lockedAt).getTime();
        if (ageMs < 30_000) {
          this.inProgress(res);
          return;
        }
      }

      // A failed row, or a processing row whose owner looks dead. Reclaim it
      // (rather than delete it) so the retry's response is cached under the
      // same id — conditionally on the lock we read, so two retries racing
      // for the same stale row cannot both proceed.
      const reclaimed = await this.db
        .update(idempotencyKeys)
        .set({ status: 'processing', requestHash, lockedAt: now, expiresAt })
        .where(
          and(
            eq(idempotencyKeys.id, existing.id),
            eq(idempotencyKeys.lockedAt, existing.lockedAt),
          ),
        )
        .returning({ id: idempotencyKeys.id });
      if (reclaimed.length === 0) {
        this.inProgress(res);
        return;
      }

      rowId = existing.id;
    }

    const originalJson = res.json.bind(res) as (body: unknown) => Response;
    let captured = false;

    res.json = (body: unknown): Response => {
      if (!captured) {
        captured = true;
        const status = res.statusCode;
        // A 5xx is a server fault, not the request's answer: caching it would
        // replay the failure for the key's whole TTL. Mark it failed so the
        // client's retry is reclaimed and actually re-executed.
        const outcome =
          status >= 500
            ? { status: 'failed' as const }
            : {
                status: 'completed' as const,
                responseStatus: status,
                responseBody: body,
                completedAt: new Date(),
              };
        void this.db
          .update(idempotencyKeys)
          .set(outcome)
          .where(eq(idempotencyKeys.id, rowId))
          .catch((err: unknown) =>
            console.error('Idempotency update failed', err),
          );
      }
      return originalJson(body);
    };

    next();
  }

  private inProgress(res: Response): void {
    res.status(409).json({
      success: false,
      error: {
        code: 'IDEMPOTENCY_IN_PROGRESS',
        message: 'Request with this idempotency key is already being processed',
      },
    });
  }

  async cleanupExpired() {
    await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()));
  }
}
