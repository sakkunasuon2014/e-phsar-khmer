import { and, inArray, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.provider';
import { userE2eDevices } from '../../db/schema/chat.schema';

/** Hard cap on active devices per user; registering past it evicts the least recently seen. */
export const MAX_ACTIVE_DEVICES = 5;

/**
 * A device unseen this long drops out of the active set (senders stop
 * encrypting to it) — unless it is among the user's STALE_FALLBACK_DEVICES
 * most recent and the user has no fresher device.
 */
export const DEVICE_STALE_DAYS = 30;

/**
 * How many of a user's most recently seen non-revoked devices stay targetable
 * when none of them was seen within DEVICE_STALE_DAYS. Staleness may shrink a
 * registered account's set but never empty it, so a seller who went quiet
 * still receives messages instead of looking "not set up".
 */
export const STALE_FALLBACK_DEVICES = 2;

export interface ActiveDevice {
  id: string;
  userId: string;
}

/** A non-revoked device row, with `fresh` = seen within DEVICE_STALE_DAYS (by the DB clock). */
export interface DeviceCandidate extends ActiveDevice {
  lastSeenAt: Date;
  fresh: boolean;
}

/**
 * The target-set rule, per user: the fresh devices if there are any,
 * otherwise the STALE_FALLBACK_DEVICES most recently seen. Each user's devices
 * come back newest first; ties break by id so every caller agrees on the set.
 */
export function pickTargetDevices(
  candidates: DeviceCandidate[],
): ActiveDevice[] {
  const byUser = new Map<string, DeviceCandidate[]>();
  for (const c of candidates) {
    const group = byUser.get(c.userId);
    if (group) group.push(c);
    else byUser.set(c.userId, [c]);
  }
  const picked: ActiveDevice[] = [];
  for (const group of byUser.values()) {
    group.sort(
      (a, b) =>
        b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const fresh = group.filter((d) => d.fresh);
    const chosen =
      fresh.length > 0 ? fresh : group.slice(0, STALE_FALLBACK_DEVICES);
    for (const d of chosen) picked.push({ id: d.id, userId: d.userId });
  }
  return picked;
}

/**
 * The one place that decides which devices a message to `userIds` must be
 * encrypted to. The devices endpoint, the bundle fetch and the send path's
 * set check all go through it, so the sender's envelope set and the server's
 * expected set cannot disagree (a mismatch would loop on E2E_DEVICES_MISMATCH).
 */
export async function loadTargetDevices(
  executor: DbExecutor,
  userIds: string[],
): Promise<ActiveDevice[]> {
  if (userIds.length === 0) return [];
  const candidates = await executor
    .select({
      id: userE2eDevices.id,
      userId: userE2eDevices.userId,
      lastSeenAt: userE2eDevices.lastSeenAt,
      fresh: sql<boolean>`${userE2eDevices.lastSeenAt} > now() - make_interval(days => ${DEVICE_STALE_DAYS})`,
    })
    .from(userE2eDevices)
    .where(
      and(
        inArray(userE2eDevices.userId, userIds),
        isNull(userE2eDevices.revokedAt),
      ),
    );
  return pickTargetDevices(candidates);
}

export interface DeviceRef {
  userId: string;
  deviceId: string;
}

/**
 * Compares the device set a sender encrypted to against the server's active
 * set. `missing` = active devices the sender left out (they'd never be able
 * to read the message); `stale` = envelopes for devices that are no longer
 * active (wasted, and a sign the sender's cached device list is old).
 */
export function diffDevices(
  expected: DeviceRef[],
  sentDeviceIds: string[],
): { missing: DeviceRef[]; stale: string[] } {
  const sent = new Set(sentDeviceIds);
  const expectedIds = new Set(expected.map((d) => d.deviceId));
  return {
    missing: expected.filter((d) => !sent.has(d.deviceId)),
    stale: sentDeviceIds.filter((id) => !expectedIds.has(id)),
  };
}

/**
 * Serializes device-set writes for the given users with transaction-scoped
 * advisory locks: a v2 send holds them while it re-reads the active device set
 * and inserts its envelopes, and registerDevice holds its own user's lock
 * across the upsert/eviction. A registration therefore cannot land between a
 * send's check and its insert and leave the new device without an envelope.
 *
 * Keys are deduped and sorted ascending before locking. Every transaction
 * takes these locks in the same order (a send locks both participants), so two
 * concurrent sends/registrations can never wait on each other's lock in
 * opposite order — that ordering, not the lock itself, is what rules out a
 * deadlock.
 */
export async function lockE2eDeviceKeys(
  tx: DbExecutor,
  userIds: string[],
): Promise<void> {
  const keys = [...new Set(userIds)].map((id) => `e2e-devices:${id}`).sort();
  const keyList = sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(key, 0)) from (select unnest(array[${keyList}]::text[]) as key order by 1) s`,
  );
}
