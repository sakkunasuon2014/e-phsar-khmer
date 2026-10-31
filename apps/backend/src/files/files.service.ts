import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../common/supabase/supabase.service';

/** Upload scopes namespaced per user (`{scope}/{userId}/…`). */
export const USER_SCOPES = [
  'listing',
  'avatar',
  'cover',
  'chat',
  'report',
] as const;

/** Catalog scopes — shared folders that only staff may write or delete. */
export const STAFF_SCOPES = [
  'category',
  'subcategory',
  'brand',
  'model',
  'product',
  'attribute',
  'advertisement',
] as const;

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  private get defaultBucket(): string {
    return (
      this.configService.get<string>('supabase.storageBucket') ?? 'listings'
    );
  }

  /**
   * True when `path` sits in one of `userId`'s own folders
   * (`listing/{id}/…`, `avatar/{id}/…`, `cover/{id}/…`, `chat/{id}/…`).
   * Rejects traversal segments outright so a prefix match can't be escaped.
   */
  isOwnedPath(path: string, userId: string): boolean {
    if (typeof path !== 'string' || path.split('/').includes('..')) {
      return false;
    }
    return USER_SCOPES.some((scope) => path.startsWith(`${scope}/${userId}/`));
  }

  /** The public URL an object at `path` in the default bucket is served from. */
  publicUrlFor(path: string): string {
    return this.supabaseService.getPublicUrl(this.defaultBucket, path).data
      .publicUrl;
  }

  /**
   * `removeByPublicUrl`, but only for objects inside `userId`'s own folders.
   * Used wherever the URL came from a client payload: without it, a user could
   * put someone else's photo URL into their own listing, drop it on the next
   * edit, and have the server delete the victim's object for them.
   */
  async removeOwnedByPublicUrl(
    publicUrl: string | null,
    userId: string,
  ): Promise<void> {
    const path = publicUrl ? this.pathFromPublicUrl(publicUrl) : null;
    if (!path || !this.isOwnedPath(path, userId)) return;
    await this.remove(this.defaultBucket, [path]);
  }

  buildObjectPath(userId: string, scope: string, filename: string): string {
    const safe = this.safeName(filename);
    return `${scope}/${userId}/${randomUUID()}-${safe}`;
  }

  async uploadPublic(
    bucket: string,
    folder: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; path: string }> {
    this.validateImage(file);
    const path = this.buildObjectPath('public', folder, file.originalname);
    const { error } = await this.supabaseService.uploadObject(
      bucket,
      path,
      file.buffer,
      file.mimetype,
    );
    if (error) throw new ForbiddenException('Upload failed');
    const { data } = this.supabaseService.getPublicUrl(bucket, path);
    return { url: data.publicUrl, path };
  }

  async createSignedUploadUrl(
    bucket: string,
    folder: string,
    filename: string,
  ): Promise<{
    signedUrl: string;
    path: string;
    token: string;
    publicUrl: string;
  }> {
    const path = `${folder}/${randomUUID()}-${this.safeName(filename)}`;
    const { data, error } = await this.supabaseService.createSignedUploadUrl(
      bucket,
      path,
    );
    if (error || !data)
      throw new ForbiddenException('Failed to create signed upload URL');
    const { data: pub } = this.supabaseService.getPublicUrl(bucket, path);
    return {
      signedUrl: data.signedUrl,
      path,
      token: data.token,
      publicUrl: pub.publicUrl,
    };
  }

  async createSignedDownloadUrl(
    bucket: string,
    path: string,
    expiresIn = 3600,
  ): Promise<{ url: string }> {
    const { data, error } = await this.supabaseService.createSignedUrl(
      bucket,
      path,
      expiresIn,
    );
    if (error || !data)
      throw new ForbiddenException('Failed to create signed URL');
    return { url: data.signedUrl };
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.supabaseService.removeObjects(bucket, paths);
    if (error) {
      // supabase-js resolves with { data, error } — it does not throw. Log the
      // failure so orphaned objects are visible instead of silently dropped.
      this.logger.warn(
        `Failed to remove ${paths.length} object(s) from bucket "${bucket}": ${this.errorMessage(error)}`,
      );
    }
  }

  /**
   * Best-effort cleanup of the storage object backing a public URL. Derives the
   * object path from the URL (only matches URLs pointing into the default
   * bucket), silently skips non-storage values (e.g. "/placeholder.svg"), and
   * never throws, so a Supabase hiccup never fails a DB operation. Failures are
   * logged. Used by admin services when an icon/image leaves the DB (entity
   * delete or replace).
   */
  async removeByPublicUrl(publicUrl: string | null): Promise<void> {
    if (!publicUrl) return;
    const bucket = this.defaultBucket;
    const objectPath = this.pathFromPublicUrl(publicUrl);
    if (objectPath === null) {
      if (publicUrl.startsWith('http')) {
        // A stored http URL that is not in our public bucket can never be
        // removed here — surface it so it can be traced back to its source.
        this.logger.warn(
          `Stored URL is not in the "${bucket}" public bucket; cannot clean up: ${publicUrl}`,
        );
      }
      return;
    }
    if (!objectPath) return;
    await this.remove(bucket, [objectPath]);
  }

  /** Object path inside the default bucket, or null for a non-bucket URL. */
  private pathFromPublicUrl(publicUrl: string): string | null {
    const marker = `/object/public/${this.defaultBucket}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    return this.decodeObjectPath(publicUrl.slice(idx + marker.length));
  }

  /** Strips query params (e.g. Supabase cache-busting tokens) and URI-decodes the object path. */
  private decodeObjectPath(raw: string): string {
    const withoutQuery = raw.split('?')[0];
    try {
      return decodeURIComponent(withoutQuery);
    } catch {
      // Malformed percent-encoding — fall back to the raw path so cleanup
      // still attempts (and logs) a best-effort removal.
      return withoutQuery;
    }
  }

  private errorMessage(error: unknown): string {
    return typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  }

  private validateImage(file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('A file is required');
    // Raster formats only — an SVG served from the public bucket can carry
    // script, which `image/*` would let through.
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

  /** Public URL for an object path in the default bucket (DB paths → admin cells). */
  getPublicUrl(path: string): string {
    return this.supabaseService.getPublicUrl(this.defaultBucket, path).data
      .publicUrl;
  }

  getDefaultBucket() {
    return this.defaultBucket;
  }
}
