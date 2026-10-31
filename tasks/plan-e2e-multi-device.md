# Plan: E2E Multi-Device (per-device identity + envelope fan-out)

**Supersedes:** decision #2 of `docs/e2e-encryption.md` (single device per identity).
**Goal:** a user logged in on N browsers/devices reads every message sent **after** each device registered, on every device, including rapid login/logout/device switching. Old chats (plaintext + v1 E2E) keep rendering exactly as today.
**Non-goal (separate phase):** reading history from **before** a device existed (device linking / backup — Phase 4/5).

---

## Implementation status (2026-09-24, re-verified 2026-10-24)

**2026-10-24:** shipped in `603aa33` (2026-09-29). The migrations named below were renumbered on the main merge: `0027` (devices + envelopes), `0028` (backup) and `0029` (`key_proof_hash`). All three are applied on the dev DB. **Phase 3 cutover is still not started.** The server still accepts v1 `e2eHeader` sends, the v1 bundle endpoint and `user_e2e_identities` remain, and `components/setting/Devices.tsx` is still a hardcoded mock. Recorded in `CHANGELOG.md` (2026-09-27 → 2026-09-30).

Phases 0–2 and 4/5 (history backup, below) implemented; Phase 3 (cutover) not started. Migrations `0023`–`0025` generated but **not applied** — run `pnpm --filter backend db:migrate`.

Deviations from the plan below (all simplifications):

- **Reads return all envelopes** of a v2 message (no `X-E2E-Device-Id` header plumbing). Each is ciphertext only its device can open; ≤ 9 × ~250 B per message.
- **Separate `user_e2e_device_prekeys` table** instead of adding `deviceId` to the v1 OTPK table (per-device prekey ids collide under the v1 `(user_id, prekey_id)` unique). v1 tables untouched.
- **Device cap evicts** the least-recently-seen device instead of 409 `E2E_DEVICE_LIMIT` — rapid switchers are never locked out. Evicted browser re-claims its row by identity key on next load.
- **v2 client storage = new IndexedDB `npic-e2e-v2`**, not a `DB_VERSION` bump — an upgrade would block while an old-build tab holds a connection.
- **One global Web Lock (`V2_LOCK`)** for all v2 sessions instead of sorted per-peer locks. No deadlock possible; cost = decrypts wait out an in-flight send.
- v2 bootstrap **does not** touch `user_e2e_identities`, so the v1 identity (and stale v1 tabs' sessions) stay pointed at the original device.
- Not built yet: `DELETE` device endpoint, `GET devices/me`, "new device added" notice, vitest (a throwaway esbuild round-trip script covered 22 crypto scenarios instead).
- Flag: `NEXT_PUBLIC_E2E_V2=off` disables v2 **sends**; default on.

### History backup + new-device approval (2026-09-25, migration `0024_hot_charles_xavier.sql`, not applied)

Phases 4 and 5 merged into one mechanism: **one backup key (BK) per account**, created in the browser by the first device (`e2e_backups.key_check` = HMAC(BK) lets devices verify they hold the current one). Every device holding BK uploads its plaintext history as AES-GCM segments (`e2e_backup_segments`) every 60 s and pulls segments newer than its saved cursor. A device without BK gets it by:

1. **Passcode (primary):** argon2id(passcode, m=19 MiB, t=2) → HKDF → `wrapKey` (never sent) + `authKey`. Server stores AES-GCM(wrapKey, BK) and bcrypt(authKey), and releases the wrapped BK only against authKey. 5 wrong tries → lock 1 h, doubling after that. The attempt is counted atomically before comparing.
2. **Approval (fallback):** the new device opens an `e2e_history_requests` row; an old device shows "Allow {Chrome · Windows}?" and sends BK over the device-to-device Double Ratchet session. It's 32 bytes, not the history.

Restored plaintext lives in a separate IndexedDB store (`npic-e2e-backup/restored`) and is consulted **only after** this device's own decrypt fails. Treating it as a cache hit would skip X3DH on messages addressed to this device and break the session.

**Hardening (2026-09-29, migration `0025_flaky_starjammers.sql`):** `setPasscode` now also requires `keyProof` = HMAC(BK, "npic-backup-proof"); the server stores only sha256 of it (`e2e_backups.key_proof_hash`) and never returns it, so a stolen session holding the public `keyCheck` can't overwrite the passcode (rows created before 0025 adopt the first proof seen). Segments are capped at 600 KB of UTF-8 JSON and the backend JSON body limit is 1 MB (Express default 100 KB 413'd large segments).

Known limits: a malicious server can brute-force a weak passcode offline against the wrapped BK (min 6 chars; argon2id slows each guess). A revoked device keeps BK (no rotation yet). No "change passcode" entry point once one is set (settings page TODO).

---

## 0. Current state (verified against code 2026-09-24)

- Identity is per **user**: `chat.user_e2e_identities` PK `userId`; `E2eKeysService.registerKeys` upserts → a second device **overwrites** the first (root cause of "Couldn't decrypt message").
- One-time prekeys keyed `(userId, prekeyId)`.
- `messages.isE2e` + `messages.e2eHeader` (JSONB) + `messages.body` = one ciphertext for one recipient.
- Web: identity in IndexedDB `npic-e2e-identity` (keyed `userId`); ratchet sessions in `npic-e2e` / `sessions` keyed **`conversationId`**; plaintext cache in `npic-e2e` / `decrypted` keyed `messageId`.
- `send-encrypt.ts` only fetches a bundle when no local session → sender never notices peer's key change (the bug).
- Web lock `withConversationLock(conversationId)` serializes one conversation.
- Latest migrations: two files share prefix `0022` (`0022_add_message_group_id.sql`, `0022_conscious_rocket_racer.sql`) — check `meta/_journal.json` before `db:generate`; next is `0023`.
- No web test framework. Crypto in `lib/e2e/**` is pure TS → testable with vitest in isolation.

---

## 1. Compatibility contract (must hold after every phase)

| Message kind                                           | How stored                 | How rendered after this plan                                                                                         |
| ------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Plaintext (`isE2e=false`)                              | unchanged                  | unchanged                                                                                                            |
| v1 E2E (`e2eVersion=1`, `e2eHeader` set, no envelopes) | unchanged, never rewritten | **legacy path**: `decrypted` cache hit → shown; else legacy `sessions` store + same identity keys → decrypt as today |
| v2 E2E (`e2eVersion=2`, envelopes)                     | new                        | device path                                                                                                          |

Rules:

1. **Never delete or rename** existing IndexedDB stores (`sessions`, `decrypted`, `identity`). Only additive upgrades (`DB_VERSION` bump + new store).
2. **Never regenerate keys for an existing device.** The v1 identity already in IndexedDB **becomes** this browser's first device (same key pair) → every v1 message it could read, it still reads.
3. Server backfills one device per existing identity row with the **same keys** → peers' v1 sessions still point at a live device.
4. Server keeps accepting v1 sends during transition (stale tabs), until Phase 3 cutover.
5. `decrypted` cache stays keyed by `messageId` for both versions — one lookup, version-agnostic.

---

## Phase 0 — Hotfix: stale-identity 409 (v1, ~0.5 day)

Fixes today's bug while Phase 1-3 are built. Mechanism reused by Phase 2.

Backend

- `E2eHeaderDto`: optional `recipientIdentityKey` (base64, 44 chars).
- `ChatService.sendMessageInternal`: when `dto.e2eHeader?.recipientIdentityKey` present, add a 4th read to the existing `Promise.all` (`userE2eIdentities.identityKey` for recipient). Mismatch → `409 { code: 'E2E_SESSION_STALE' }`. Absent → no check (old clients unaffected).

Web

- `engine.encrypt`: set `recipientIdentityKey` = remote half of `session.associatedData` (initiator: last 32 bytes; responder: first 32 bytes — store `role` on session at creation, or pass `bundle.identityKey` for new sessions).
- `sendE2eText`: on 409 `E2E_SESSION_STALE` → delete session for conversation, fetch bundle, re-encrypt, retry **once** (inside same lock).
- `E2eStore`: add `deleteSession(conversationId)`.

Tests: backend spec for match / mismatch / absent. Manual: login device B → peer sends → decrypts on B.

---

## Phase 1 — Devices on the server, additive (~1.5 days, zero behavior change)

### 1.1 Schema (`chat.schema.ts`, migration `0023`)

```ts
export const userE2eDevices = chatSchema.table(
  "user_e2e_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(), // deviceId
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    identityKey: text("identity_key").notNull(),
    identitySigningKey: text("identity_signing_key").notNull(),
    registrationId: integer("registration_id").notNull(),
    signedPrekeyId: integer("signed_prekey_id").notNull(),
    signedPrekeyPublic: text("signed_prekey_public").notNull(),
    signedPrekeySignature: text("signed_prekey_signature").notNull(),
    signedPrekeyCreatedAt: timestamp("signed_prekey_created_at", {
      withTimezone: true,
    }).notNull(),
    label: varchar("label", { length: 100 }), // "Chrome on Windows"
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("user_e2e_devices_identity_uq").on(t.userId, t.identityKey),
    index("user_e2e_devices_active_idx")
      .on(t.userId)
      .where(sql`revoked_at is null`),
  ],
);

export const messageEnvelopes = chatSchema.table(
  "message_envelopes",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    recipientDeviceId: uuid("recipient_device_id")
      .notNull()
      .references(() => userE2eDevices.id, { onDelete: "cascade" }),
    senderDeviceId: uuid("sender_device_id")
      .notNull()
      .references(() => userE2eDevices.id, { onDelete: "cascade" }),
    header: jsonb("header").$type<E2eHeader>().notNull(),
    wrappedKey: text("wrapped_key").notNull(), // base64, ratchet-encrypted content key
  },
  (t) => [primaryKey({ columns: [t.messageId, t.recipientDeviceId] })],
);
```

- `messages`: add `e2eVersion smallint` (null = plaintext, 1 = v1, 2 = v2). Migration backfills `1` where `is_e2e`.
- `user_e2e_one_time_prekeys`: add nullable `deviceId` FK → devices; new unique `(device_id, prekey_id)`; partial index on `device_id where used_at is null`. Old `(user_id, prekey_id)` unique stays until Phase 3 cleanup.
- **Backfill (same migration, hand-edited SQL):**
  ```sql
  insert into chat.user_e2e_devices (user_id, identity_key, identity_signing_key, registration_id,
    signed_prekey_id, signed_prekey_public, signed_prekey_signature, signed_prekey_created_at)
  select user_id, identity_key, identity_signing_key, registration_id,
    signed_prekey_id, signed_prekey_public, signed_prekey_signature, signed_prekey_created_at
  from chat.user_e2e_identities;
  update chat.user_e2e_one_time_prekeys p set device_id = d.id
  from chat.user_e2e_devices d where d.user_id = p.user_id;
  ```
- `user_e2e_identities` **kept** (v1 bundle endpoint still reads it). Dropped only in Phase 3.

### 1.2 Endpoints (`E2eKeysController`, all JWT)

| Route                                     | Purpose                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /chats/e2e/devices`                 | Register-or-claim. Body = public keys + OTPKs + label. If `(userId, identityKey)` exists → return its `deviceId` (this is how a v1 browser adopts its backfilled device — **no new keys**). Else insert. Enforce cap 5 active → 409 `E2E_DEVICE_LIMIT`. |
| `POST /chats/e2e/devices/:id/prekeys`     | Replenish OTPKs / rotate signed prekey (owner only).                                                                                                                                                                                                    |
| `GET /chats/e2e/devices/me`               | List own devices (for settings page).                                                                                                                                                                                                                   |
| `DELETE /chats/e2e/devices/:id`           | Revoke (owner only): `revokedAt=now()`, delete unused OTPKs.                                                                                                                                                                                            |
| `GET /chats/e2e/users/:userId/devices`    | Active device ids (+ identity keys) — no prekey claim. Block-checked.                                                                                                                                                                                   |
| `GET /chats/e2e/devices/:deviceId/bundle` | Bundle for one device, claims one OTPK (SKIP LOCKED, same as today). Block-checked via device owner.                                                                                                                                                    |

- Old `POST /chats/e2e/keys` (v1): keep, but **also** upsert the device row by `(userId, identityKey)` so a stale v1 tab re-registering doesn't orphan anything.
- `lastSeenAt`: bumped when a request carries `X-E2E-Device-Id` owned by caller (throttled like `ActivityService.touch`, 5 min).
- Nightly/cheap sweep (or lazy on list): `lastSeenAt < now()-30d` → revoked.

Tests: register new / claim existing / cap / revoke / bundle claim per device / block check / backfill SQL on a copy of dev DB.

**Ship Phase 1 alone → nothing reads devices yet; zero client change.**

---

## Phase 2 — v2 send/receive (~3-4 days)

### 2.1 Wire format

```ts
// SendMessageDto (v2)
{
  recipientId, clientMessageId, listingId?,
  body: base64(AEAD(contentKey, plaintext, aad = senderDeviceId)),
  e2e: {
    v: 2,
    senderDeviceId: string,
    envelopes: { deviceId: string; header: E2eHeader; wrappedKey: string }[] // max 10
  }
}
```

- `contentKey` = 32 random bytes per message; reuse `aeadEncrypt` from `crypto/primitives.ts`.
- `wrappedKey` = `ratchetEncrypt(sessionWith(device), contentKey)`; `header` = DR header (+ X3DH fields on first message to that device).
- Targets = recipient's active devices **∪ sender's own active devices minus `senderDeviceId`**.

### 2.2 Server — `ChatService.sendMessageInternal`

1. `dto.e2e` and `dto.e2eHeader` mutually exclusive (400).
2. `senderDeviceId` must be an active device of `senderId` (403).
3. Add to the existing `Promise.all`: active device ids of recipient + sender.
4. Compare envelope set vs expected:
   `missing = expected − sent`, `stale = sent − expected` → if any: **409 `{ code: 'E2E_DEVICES_MISMATCH', missing, stale }`**. Nothing written.
5. One transaction: insert `messages` (`isE2e=true, e2eVersion=2, e2eHeader=null`) + all `message_envelopes`.
6. Push: `message` event now sent to **recipient AND sender** (sender's other devices need it). Payload includes all envelopes; each client picks its own. (Payload ≈ 150 B × ≤10.)

### 2.3 Server — reads

- History / polling / inbox last-message: accept `X-E2E-Device-Id` (REST) and `?deviceId=` (WS connect). Left-join `message_envelopes` on `(message_id, recipient_device_id = :deviceId)` → return `envelope: {senderDeviceId, header, wrappedKey} | null`. v1 rows unaffected (`envelope` null, `e2eHeader` as today).
- `batchLoadLastMessages` same join (inbox preview decrypt).
- Device id not owned by caller → treat as absent (no envelope), never 403 — avoids breaking reads on a revoked device.

### 2.4 Web — keys & store

- `keys.ts`: `StoredIdentity` gains `deviceId: string | null` (IndexedDB schema-less → no version bump for identity DB).
- `engine-provider.ts` bootstrap:
  1. load/generate identity (unchanged — existing keys reused).
  2. if `deviceId == null` → `POST /chats/e2e/devices` → store returned id. Existing v1 browser gets its **backfilled** device (same identityKey) → no break.
  3. replenish per device.
- **Logout does NOT wipe identity** (already true — keyed by `userId`). Same browser re-login = same device. This is what makes rapid switching cheap: device churn only on genuinely new browser profiles.
- `store.ts`: `DB_VERSION 2`, add store `deviceSessions` keyed `peerKey = ${peerUserId}:${peerDeviceId}`. Old `sessions` store untouched (legacy decrypt).
- `E2eStore` additions: `getDeviceSession(peerKey)`, `deleteDeviceSession(peerKey)`, `commitV2(sessions: Map<peerKey, session>, messageId, plaintext)` — one IDB transaction.
- Device list cache: `peerDevices:${userId}` → `deviceId[]` (memory + IDB), refreshed on 409 or when empty.

### 2.5 Web — send (`send-encrypt.ts` → `sendE2eTextV2`)

```
lock keys = sorted(all target peerKeys)         // acquire in order → no deadlock
devices  = cached(recipient) ∪ cached(self) − myDevice
for attempt in 0..2:
  contentKey = random32; body = aead(contentKey, plaintext, myDeviceId)
  for d in devices: session = getDeviceSession(d) ?? x3dh(fetchBundle(d)); wrap
  res = POST send
  if 409 E2E_DEVICES_MISMATCH:
     drop sessions for res.stale; devices = devices − stale + missing; continue
  if ok: commitV2(all advanced sessions, message.id, plaintext); return ok
return "devices-changed, try again"
```

- Sessions committed **only after 201** (same rule as today). Unsent encrypt attempts don't advance stored state (encrypt works on copies).
- Lock: new `withSessionLocks(keys[], fn)` — nested `navigator.locks.request` in sorted order. Needed because **self-device sessions are shared across all conversations**; per-conversation lock is no longer enough.
- Zero peer devices registered → keep today's `no-recipient-keys` refusal.

### 2.6 Web — decrypt (`decrypt-message.ts`)

```
if cached(messageId) → ok                        // both versions
if message.e2eVersion === 1 → legacy path (current code, unchanged)
if message.e2eVersion === 2:
   env = message.envelope; if !env → status "not-for-this-device"
   peerKey = `${senderId}:${env.senderDeviceId}`
   lock(peerKey):
     session = isNewSession(env.header) ? null : getDeviceSession(peerKey)
     contentKey = engine.decrypt(session, env.header, env.wrappedKey)
     plaintext = aeadDecrypt(contentKey, body, aad = senderDeviceId)
     commitV2({peerKey: newSession}, messageId, plaintext)
```

- `RatchetEngine` gets byte-level `decryptBytes/encryptBytes` (wrappedKey is bytes, not UTF-8 text); keep text API for v1.
- Own message sent from **this** device: plaintext already cached at send → served from cache.
- Own message sent from **another** device: envelope addressed to this device → decrypts. (Fixes "own messages blank on new device" for everything after registration.)

### 2.7 UX states (`DecryptOutcome`)

| status                | Text                                                     |
| --------------------- | -------------------------------------------------------- |
| `ok`                  | plaintext                                                |
| `not-for-this-device` | "Sent before this device was added" (i18n all 6 locales) |
| `failed`              | "Couldn't decrypt message" (real crypto error only)      |

Also: toast "New device added to your account" when own device list grows (cheap `GET devices/me` diff on bootstrap) — mitigates server-injected device.

### 2.8 Feature flag

- `NEXT_PUBLIC_E2E_V2` (web). Off → client sends v1 (with Phase 0 check). On → v2. Reads handle both regardless of flag. Allows staged enable + instant rollback without data loss (v2 rows keep decrypting because decode path is always shipped).

Tests

- Backend: mismatch 409 (missing / stale / both), non-owned senderDeviceId 403, tx atomicity (envelope insert fails → no message), read join per device, v1 path unchanged.
- Web (add vitest scoped to `lib/e2e/**`): 2 users × 2 devices round-trip; device added mid-conversation → 409 → retry succeeds; device revoked → stale dropped; v1 message still decrypts after `DB_VERSION` upgrade; duplicate delivery idempotent; out-of-order.
- Browser (CLAUDE.md chromium recipe): two profiles same user + one peer profile.

---

## Phase 3 — Cutover & cleanup (~0.5 day, after 2 weeks of v2 on)

- Server rejects new v1 sends: 426 `E2E_CLIENT_OUTDATED` → web forces reload.
- `GET /chats/e2e/keys/:userId/bundle` (v1) removed; drop `user_e2e_identities`; OTPK `device_id` → NOT NULL, drop `(user_id, prekey_id)` unique.
- **Never** drop `messages.e2eHeader` or the legacy decrypt path — old history depends on it.
- `/settings/devices` page: list + revoke (`components/setting/Devices.tsx`).

---

## Phase 4/5 (later, separate spec)

- **4 — Device linking (history transfer):** QR on old device → X3DH to new device → stream `decrypted` cache (messageId → plaintext) encrypted. Makes pre-registration history readable.
- **5 — Passphrase backup:** Argon2id-derived key encrypts identity + `decrypted` cache → server blob. For "no old device available".

---

## Risk register

| Risk                                                                                   | Mitigation                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backfill creates device with keys that don't match any browser (browser storage wiped) | Harmless: device goes stale, auto-revoked after 30 d; senders get `stale` in 409 once revoked. Until then messages to it are undecryptable anywhere — acceptable, same as today. |
| Retry loop during rapid device churn                                                   | Max 2 retries → user-visible "try again"; device list cached so steady state costs 0 extra calls.                                                                                |
| Fan-out cost                                                                           | Cap 5 devices/user → ≤ 9 envelopes/message.                                                                                                                                      |
| Self-device session race across tabs/conversations                                     | Sorted multi-lock per peerKey (§2.5).                                                                                                                                            |
| Shared computer keeps prior user's keys in IndexedDB                                   | Keyed by userId, not usable by other account; add "Remove this device" on logout (calls revoke + wipes identity) in Phase 3.                                                     |
| Server adds rogue device                                                               | "New device added" notice (§2.7); safety numbers later.                                                                                                                          |
| Stale tabs on old build sending v1                                                     | v1 accepted until Phase 3; Phase 0 check keeps them correct.                                                                                                                     |
| Duplicate `0022` migration prefix                                                      | Verify `_journal.json` order before generating `0023`.                                                                                                                           |

## Rollout order

1. Phase 0 → deploy → verify bug gone.
2. Phase 1 migration + endpoints → deploy (no client change) → verify backfill counts = identity rows.
3. Phase 2 code with flag off → deploy → verify v1 still fine, device ids registered (`user_e2e_devices.last_seen_at` moving).
4. Flag on for dev accounts → two-device test → flag on for all.
5. Phase 3 after 2 weeks clean.

## Verified before starting (2026-09-24)

1. `components/setting/Devices.tsx` = **hardcoded mock** ("Chrome 147") → Phase 3 wires it to `GET /chats/e2e/devices/me`.
2. WS `message` push dedupes by id (`use-chat-thread.ts:126`) → sender receiving own push is safe.
3. Journal's last entry = `0022_conscious_rocket_racer`. `0022_add_message_group_id.sql` is **not in the journal** → drizzle never runs it; its `messages_group_id_idx` index does not exist unless applied by hand. Delete the orphan file (or add the index to `chat.schema.ts`) before generating `0023`.

## Open decision

- Add vitest to `apps/web` scoped to `lib/e2e/**`? CLAUDE.md says no web test framework today. Recommended: yes — multi-device crypto without round-trip tests is the main risk in this plan.
