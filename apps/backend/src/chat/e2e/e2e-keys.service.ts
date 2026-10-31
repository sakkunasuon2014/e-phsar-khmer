import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/drizzle.provider';
import type { DbClient } from '../../db/drizzle.provider';
import {
  userE2eDevicePrekeys,
  userE2eDevices,
  userE2eIdentities,
  userE2eOneTimePrekeys,
} from '../../db/schema/chat.schema';
import { isBlockedEitherWay } from '../blocks.util';
import type { RegisterE2eKeysDto } from './dto/register-e2e-keys.dto';
import type { RegisterE2eDeviceDto } from './dto/register-e2e-device.dto';
import type { AddDevicePrekeysDto } from './dto/add-device-prekeys.dto';
import type { E2eDeviceBundle, E2eKeyBundle } from './e2e-keys.types';
import {
  loadTargetDevices,
  lockE2eDeviceKeys,
  MAX_ACTIVE_DEVICES,
} from './e2e-devices.util';
import type { ActiveDevice } from './e2e-devices.util';

@Injectable()
export class E2eKeysService {
  constructor(@Inject(DRIZZLE) private readonly db: DbClient) {}

  /**
   * Upserts the identity + signed prekey (a re-registration rotates them —
   * this is also how a second device silently invalidates the first
   * device's sessions, by design: spec decision #2 / design §9) and inserts
   * any one-time prekeys not already present. Public material only —
   * nothing here ever sees a private key.
   *
   * When the identity actually rotates, the previous generation's unused
   * one-time prekeys are dropped first — see the purge below for why the
   * insert's own conflict handling cannot cover that case.
   */
  async registerKeys(
    userId: string,
    dto: RegisterE2eKeysDto,
  ): Promise<{ accepted: number }> {
    await this.db.transaction(async (tx) => {
      // Read the stored identityKey BEFORE the upsert. It is the only thing
      // that separates a *replayed* registration (same identity — the
      // onConflictDoNothing below is correct for it) from a *rotation* (a
      // brand-new identity), and the two need opposite treatment for prekeys.
      const [existing] = await tx
        .select({ identityKey: userE2eIdentities.identityKey })
        .from(userE2eIdentities)
        .where(eq(userE2eIdentities.userId, userId))
        .limit(1);

      await tx
        .insert(userE2eIdentities)
        .values({
          userId,
          identityKey: dto.identityKey,
          identitySigningKey: dto.identitySigningKey,
          registrationId: dto.registrationId,
          signedPrekeyId: dto.signedPrekeyId,
          signedPrekeyPublic: dto.signedPrekeyPublic,
          signedPrekeySignature: dto.signedPrekeySignature,
          signedPrekeyCreatedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: userE2eIdentities.userId,
          set: {
            identityKey: dto.identityKey,
            identitySigningKey: dto.identitySigningKey,
            registrationId: dto.registrationId,
            signedPrekeyId: dto.signedPrekeyId,
            signedPrekeyPublic: dto.signedPrekeyPublic,
            signedPrekeySignature: dto.signedPrekeySignature,
            signedPrekeyCreatedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });

      // A rotation replaces the client's whole prekey store, and the fresh
      // prekeys reuse ids 1..N — so every one of them would conflict below
      // and be silently discarded, leaving the pool full of public keys
      // whose private halves no longer exist on any device (every sender
      // handed one derives a different DH4 and can never decrypt).
      //
      // Only *unused* rows are dropped: a claimed row can never be served
      // again (getBundle filters `used_at is null`), so it is inert, and
      // keeping it preserves the audit trail.
      //
      // Guarded on the identity actually changing: the replenish path
      // re-registers the SAME identity with a fresh batch, and purging
      // there would wipe valid keys on every top-up.
      const rotated =
        existing !== undefined && existing.identityKey !== dto.identityKey;

      if (rotated) {
        await tx
          .delete(userE2eOneTimePrekeys)
          .where(
            and(
              eq(userE2eOneTimePrekeys.userId, userId),
              isNull(userE2eOneTimePrekeys.usedAt),
            ),
          );
      }

      if (dto.oneTimePrekeys.length > 0) {
        await tx
          .insert(userE2eOneTimePrekeys)
          .values(
            dto.oneTimePrekeys.map((k) => ({
              userId,
              prekeyId: k.prekeyId,
              publicKey: k.publicKey,
            })),
          )
          // Matches the partial unique index — a replayed registration call
          // (e.g. a retried request) never duplicates a prekey id.
          .onConflictDoNothing({
            target: [
              userE2eOneTimePrekeys.userId,
              userE2eOneTimePrekeys.prekeyId,
            ],
          });
      }
    });

    return { accepted: dto.oneTimePrekeys.length };
  }

  /**
   * Fetches a bundle to start an X3DH handshake, atomically claiming one
   * one-time prekey in the same shape as OutboxService.claim() — SKIP LOCKED
   * so concurrent callers never claim the same row twice. A null
   * `oneTimePrekey` (pool exhausted) is a graceful degradation, not an
   * error: X3DH can proceed on the signed prekey alone.
   *
   * Gated by the same block check as ChatService.sendMessage — a block
   * disables every chat interaction surface, not just sending. Without this,
   * a blocked user could still enumerate whether the target has E2E enabled
   * and burn through their one-time prekey pool for sessions that could
   * never send a message anyway.
   */
  async getBundle(
    callerId: string,
    targetUserId: string,
  ): Promise<E2eKeyBundle> {
    if (await isBlockedEitherWay(this.db, callerId, targetUserId))
      throw new ForbiddenException('Messaging unavailable');

    const [identity] = await this.db
      .select()
      .from(userE2eIdentities)
      .where(eq(userE2eIdentities.userId, targetUserId))
      .limit(1);
    if (!identity)
      throw new NotFoundException('User has not registered E2E keys');

    const [claimed] = await this.db
      .update(userE2eOneTimePrekeys)
      .set({ usedAt: sql`now()` })
      .where(
        sql`${userE2eOneTimePrekeys.id} in (
          select ${userE2eOneTimePrekeys.id} from ${userE2eOneTimePrekeys}
          where ${userE2eOneTimePrekeys.userId} = ${targetUserId}
            and ${userE2eOneTimePrekeys.usedAt} is null
          order by ${userE2eOneTimePrekeys.prekeyId}
          for update skip locked
          limit 1
        )`,
      )
      .returning();

    return {
      identityKey: identity.identityKey,
      identitySigningKey: identity.identitySigningKey,
      registrationId: identity.registrationId,
      signedPrekeyId: identity.signedPrekeyId,
      signedPrekeyPublic: identity.signedPrekeyPublic,
      signedPrekeySignature: identity.signedPrekeySignature,
      oneTimePrekey: claimed
        ? { prekeyId: claimed.prekeyId, publicKey: claimed.publicKey }
        : null,
    };
  }

  async getPrekeyCount(userId: string): Promise<{ available: number }> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(userE2eOneTimePrekeys)
      .where(
        and(
          eq(userE2eOneTimePrekeys.userId, userId),
          isNull(userE2eOneTimePrekeys.usedAt),
        ),
      );
    return { available: row?.count ?? 0 };
  }

  // ── Multi-device (v2) ────────────────────────────────────────────────────
  // See tasks/plan-e2e-multi-device.md. Nothing below reads or writes the v1
  // tables above: stale v1 clients keep working against those unchanged.

  /**
   * Register-or-claim a device by identity key. A known key (same browser,
   * or the migration-backfilled row for a pre-multi-device browser) is
   * reactivated in place — no new device, so every session peers already
   * hold with it stays valid. Registering past MAX_ACTIVE_DEVICES evicts the
   * least recently seen devices instead of refusing: a user who keeps
   * switching browsers must never be locked out of their own chat.
   */
  async registerDevice(
    userId: string,
    dto: RegisterE2eDeviceDto,
  ): Promise<{ deviceId: string }> {
    return this.db.transaction(async (tx) => {
      // Serializes with v2 sends for this user: a send holds the same
      // transaction-scoped lock while it re-reads the active set and inserts
      // its envelopes, so this device is either visible to that re-read or
      // waits until the send commits (sorted keys → no deadlock).
      await lockE2eDeviceKeys(tx, [userId]);

      const [device] = await tx
        .insert(userE2eDevices)
        .values({
          userId,
          identityKey: dto.identityKey,
          identitySigningKey: dto.identitySigningKey,
          registrationId: dto.registrationId,
          signedPrekeyId: dto.signedPrekeyId,
          signedPrekeyPublic: dto.signedPrekeyPublic,
          signedPrekeySignature: dto.signedPrekeySignature,
          signedPrekeyCreatedAt: sql`now()`,
          label: dto.label ?? null,
        })
        .onConflictDoUpdate({
          target: [userE2eDevices.userId, userE2eDevices.identityKey],
          set: {
            identitySigningKey: dto.identitySigningKey,
            registrationId: dto.registrationId,
            signedPrekeyId: dto.signedPrekeyId,
            signedPrekeyPublic: dto.signedPrekeyPublic,
            signedPrekeySignature: dto.signedPrekeySignature,
            lastSeenAt: sql`now()`,
            ...(dto.label ? { label: dto.label } : {}),
            revokedAt: null,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: userE2eDevices.id });

      if (dto.oneTimePrekeys.length > 0) {
        await tx
          .insert(userE2eDevicePrekeys)
          .values(
            dto.oneTimePrekeys.map((k) => ({
              deviceId: device.id,
              prekeyId: k.prekeyId,
              publicKey: k.publicKey,
            })),
          )
          .onConflictDoNothing({
            target: [
              userE2eDevicePrekeys.deviceId,
              userE2eDevicePrekeys.prekeyId,
            ],
          });
      }

      // Keep the newest MAX_ACTIVE_DEVICES (this one included — it was just
      // touched); revoke the rest.
      await tx
        .update(userE2eDevices)
        .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          sql`${userE2eDevices.id} in (
            select ${userE2eDevices.id} from ${userE2eDevices}
            where ${userE2eDevices.userId} = ${userId}
              and ${userE2eDevices.revokedAt} is null
              and ${userE2eDevices.id} <> ${device.id}
            order by ${userE2eDevices.lastSeenAt} desc
            offset ${MAX_ACTIVE_DEVICES - 1}
          )`,
        );

      return { deviceId: device.id };
    });
  }

  /**
   * Called on every client bootstrap: bumps lastSeenAt (keeps the device in
   * the active set) and reports the remaining prekey pool. 404 when the
   * device was evicted/revoked — the client then re-registers, which
   * reactivates it by identity key.
   */
  async heartbeatDevice(
    userId: string,
    deviceId: string,
    label?: string,
  ): Promise<{ available: number }> {
    const [device] = await this.db
      .update(userE2eDevices)
      .set({ lastSeenAt: sql`now()`, ...(label ? { label } : {}) })
      .where(
        and(
          eq(userE2eDevices.id, deviceId),
          eq(userE2eDevices.userId, userId),
          isNull(userE2eDevices.revokedAt),
        ),
      )
      .returning({ id: userE2eDevices.id });
    if (!device) throw new NotFoundException('Device not active');

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(userE2eDevicePrekeys)
      .where(
        and(
          eq(userE2eDevicePrekeys.deviceId, deviceId),
          isNull(userE2eDevicePrekeys.usedAt),
        ),
      );
    return { available: row?.count ?? 0 };
  }

  async addDevicePrekeys(
    userId: string,
    deviceId: string,
    dto: AddDevicePrekeysDto,
  ): Promise<{ accepted: number }> {
    const [device] = await this.db
      .select({ id: userE2eDevices.id })
      .from(userE2eDevices)
      .where(
        and(
          eq(userE2eDevices.id, deviceId),
          eq(userE2eDevices.userId, userId),
          isNull(userE2eDevices.revokedAt),
        ),
      )
      .limit(1);
    if (!device) throw new NotFoundException('Device not active');

    if (dto.oneTimePrekeys.length > 0) {
      await this.db
        .insert(userE2eDevicePrekeys)
        .values(
          dto.oneTimePrekeys.map((k) => ({
            deviceId,
            prekeyId: k.prekeyId,
            publicKey: k.publicKey,
          })),
        )
        .onConflictDoNothing({
          target: [
            userE2eDevicePrekeys.deviceId,
            userE2eDevicePrekeys.prekeyId,
          ],
        });
    }
    return { accepted: dto.oneTimePrekeys.length };
  }

  /**
   * Active device ids for `targetUserId`, newest first — the set a sender
   * must encrypt to (loadTargetDevices: fresh devices, else the newest two
   * stale ones). Claims no prekey. Block-gated like getBundle, except for the caller's
   * own devices (the send path fans out to those too).
   */
  async listActiveDevices(
    callerId: string,
    targetUserId: string,
  ): Promise<string[]> {
    if (
      callerId !== targetUserId &&
      (await isBlockedEitherWay(this.db, callerId, targetUserId))
    )
      throw new ForbiddenException('Messaging unavailable');

    const devices = await loadTargetDevices(this.db, [targetUserId]);
    return devices.map((d) => d.id);
  }

  /** Active devices of several users in one query — the send path's set check. */
  loadActiveDevices(userIds: string[]): Promise<ActiveDevice[]> {
    return loadTargetDevices(this.db, userIds);
  }

  /** Bundle for ONE device, claiming one of its one-time prekeys (SKIP LOCKED). */
  async getDeviceBundle(
    callerId: string,
    deviceId: string,
  ): Promise<E2eDeviceBundle> {
    const [device] = await this.db
      .select()
      .from(userE2eDevices)
      .where(
        and(eq(userE2eDevices.id, deviceId), isNull(userE2eDevices.revokedAt)),
      )
      .limit(1);
    // Same rule as the devices list: a stale device is served only while it
    // is in its owner's fallback set, so a sender can always fetch a bundle
    // for every id listActiveDevices returned.
    if (
      !device ||
      !(await loadTargetDevices(this.db, [device.userId])).some(
        (d) => d.id === device.id,
      )
    )
      throw new NotFoundException('Device not active');
    if (
      device.userId !== callerId &&
      (await isBlockedEitherWay(this.db, callerId, device.userId))
    )
      throw new ForbiddenException('Messaging unavailable');

    const [claimed] = await this.db
      .update(userE2eDevicePrekeys)
      .set({ usedAt: sql`now()` })
      .where(
        sql`${userE2eDevicePrekeys.id} in (
          select ${userE2eDevicePrekeys.id} from ${userE2eDevicePrekeys}
          where ${userE2eDevicePrekeys.deviceId} = ${deviceId}
            and ${userE2eDevicePrekeys.usedAt} is null
          order by ${userE2eDevicePrekeys.prekeyId}
          for update skip locked
          limit 1
        )`,
      )
      .returning();

    return {
      deviceId: device.id,
      userId: device.userId,
      identityKey: device.identityKey,
      identitySigningKey: device.identitySigningKey,
      registrationId: device.registrationId,
      signedPrekeyId: device.signedPrekeyId,
      signedPrekeyPublic: device.signedPrekeyPublic,
      signedPrekeySignature: device.signedPrekeySignature,
      oneTimePrekey: claimed
        ? { prekeyId: claimed.prekeyId, publicKey: claimed.publicKey }
        : null,
    };
  }
}
