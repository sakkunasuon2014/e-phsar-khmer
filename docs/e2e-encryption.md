# End-to-End Encryption for Chat Messages — design

> Design reference (moved from `tasks/spec-e2e-encryption.md` on 2026-10-24). The protocol decisions and design §1–§9 are current; code comments cite "design §9" and "decision #2". Rollout steps, the file inventory and the pre-E2E code snapshot were dropped (they are in git history). Multi-device (`tasks/plan-e2e-multi-device.md`) and attachments (`e2e-attachments.md`) extend this design.

## Status

**Update 2026-10-24:** the client engine has since been round-tripped. A 22-scenario esbuild script ran when multi-device shipped, and a 20-check script on 2026-10-24 covered X3DH, the Double Ratchet, tamper/replay/wrong-key rejection and the voice/location payloads. Decision #2 (single device) is superseded by `plan-e2e-multi-device.md`, and #3 (text only) by `plan-e2e-attachments.md`. New sends are E2E-only since 2026-10-24 (`5f1d1b6`). The paragraph below is the original 2026-09-30 status.

**Backend Phases 1–3 shipped and tested; client crypto engine built and reasoned through against spec but never round-tripped (no test runner in `apps/web` — see Open questions).** No client key-bootstrap flow and no UI wiring yet — see Current state for the precise line between done and not-done. This file is standalone — it does not touch or depend on `tasks/spec.md` / `tasks/plan.md` (a separate, unrelated chat-scaling effort: idempotency, ordering, outbox delivery). Nothing in this spec assumes any of that work has landed.

## Decisions taken (confirmed in discussion)

1. **Signal Protocol primitives** (X3DH key agreement + Double Ratchet) — **not** via `@signalapp/libsignal-client` as originally planned. That package is Node-native only (no official browser/WASM build exists from Signal), and the only alternatives are unofficial, unaudited community WASM forks. Since this system has no requirement to interoperate with the real Signal network, X3DH + Double Ratchet are implemented directly against the published specs, on top of audited primitives (`@noble/curves`, `@noble/ciphers`, `@noble/hashes`) rather than a hand-rolled ratchet or MTProto-style custom crypto. See Design §1 for the full reasoning and what was rejected.
2. **Single device per identity, v1.** No multi-device sync. A new login/install generates a fresh identity; it cannot decrypt history from another device. Same mental model users already have from Telegram Secret Chats.
3. **Text messages only, v1.** Chat images (`imageUrl`/`imagePath`) stay plaintext-URL for now — see Non-goals.
4. **User-to-user only.** No group chat exists in this codebase (`chat.conversations` enforces exactly one row per unordered pair) and this spec does not introduce one. The group-fanout cost that makes Double Ratchet expensive at scale does not apply here.
5. **Server becomes a ciphertext relay for message bodies.** It cannot read content, search it, or moderate it. This is the central product trade-off of the whole spec — see "What the server gives up."
6. **No plaintext fallback, ever — fail closed.** If a recipient has no registered E2E keys, the send is refused with a clear client-side error, not silently downgraded to plaintext. Acceptable because dev-stage means every client can be forced to bootstrap keys at login (design §9); kept as the permanent behavior post-dev too, since a silent plaintext fallback would quietly reintroduce the exact leak this feature exists to close.
7. **Prekey pool size (100) and replenish threshold (<10) adopt Signal's own reference defaults as final v1 values**, not a placeholder — see "Deciding the numeric parameters" below for why this one didn't need npic-specific research.
8. **`messages_body_length_max` ships with a provisional value (24000) pending a real measurement**, tracked as a checklist item, not an open-ended question — see the same section. **Shipped at 24000** (migration `0017`).
9. **Identity key is split into two keys, not one.** X3DH needs the identity key to both Diffie-Hellman (X25519) and sign the signed-prekey (Ed25519). Signal's own XEdDSA scheme lets one key do both via an Edwards↔Montgomery curve conversion; `@noble/curves` doesn't expose that conversion publicly, and hand-rolling elliptic-curve point conversion math is exactly the kind of risk decision #1 exists to avoid. `user_e2e_identities` carries both `identityKey` (X25519, DH) and `identitySigningKey` (Ed25519, signing) — shipped in migration `0018`.

## Goals

- Message **bodies** sent through `ChatModule` are encrypted client-side before they leave the sender's device and decrypted client-side on the recipient's device. The backend, the database, and anyone with DB/log access see ciphertext only.
- Forward secrecy: compromising a device's current key material does not expose past messages.
- Works transparently over both REST (`POST /chats/messages`) and the WS gateway, because both already funnel through one service method — no protocol-specific crypto plumbing.
- Coexists with today's plaintext history: this is additive, not a breaking migration. Old messages stay readable as plaintext; new messages between two E2E-capable clients are ciphertext.

## Non-goals (explicitly out of scope for this spec)

- **Multi-device.** No device linking, no cross-device history sync, no device revocation UI. Decision #2 above.
- **Group chat.** No such feature exists; not introduced here.
- **Chat image encryption.** Encrypting image bytes client-side before upload is a real feature but a separate, heavier lift (per-image key management, `ImageUpload.tsx` changes, decrypt-on-view). Tracked as a follow-up, not blocking text E2E.
- **Metadata protection.** The server still sees who messages whom, when, and how often (`conversations`, `readAt`, timestamps are all unencrypted and must stay queryable for inbox/unread-count/polling to work at all).
- **Encrypted backup / key recovery.** Losing the device's local key storage means losing the ability to decrypt that device's E2E history. No server-side encrypted backup (e.g. Signal PIN/SVR-style) is built here.
- **Retroactive encryption of existing plaintext messages.** Not feasible without original session state, and not attempted.
- **Message-content moderation redesign.** There is no existing feature to preserve (see Current state), so none is built here either. If/when a "report this message" feature is proposed, it will need reporter-supplied plaintext evidence (screenshot) rather than server-side content access — flagged as an open item for whoever builds that feature, not solved here.

## What the server gives up (read this before approving)

Once a conversation is E2E, `chat.messages.body` is opaque ciphertext. Concretely, the backend can no longer:

- Show a plaintext preview anywhere (none exists today — no push notifications per the repo's Known Gaps — so nothing regresses, but nothing gains that capability later without a client-side opt-in preview scheme).
- Full-text search message bodies (no such feature exists today either).
- Have any future automated content-moderation pass read message text.

This is the real cost of the feature. Everything else in this spec is mechanism.

## Design

### 1. Crypto library

**Originally planned:** `@signalapp/libsignal-client`. **Rejected on implementation**, once the actual npm package was checked: it ships Node-native (N-API) binaries for Windows/macOS/Linux only — it cannot run in a browser tab. Signal has never published an official browser/WASM build. The only browser-capable options are unofficial community forks of libsignal (e.g. `theju/libsignal-wasm`, `getmaapp/signal-wasm`) — unaudited, uncertain maintenance, and one explicitly documented as "not a complete replacement."

**Decision: implement X3DH + Double Ratchet directly**, on top of audited primitives rather than an unaudited fork of someone else's protocol code:

- `@noble/curves` — X25519 (DH) and Ed25519 (signing).
- `@noble/ciphers` — AES-256-GCM (AEAD).
- `@noble/hashes` — HKDF, HMAC-SHA256 (the two KDFs), `randomBytes`.

The reasoning, since this is a real departure from "just use the vetted library": this system doesn't interoperate with the actual Signal network, so there was never a wire-format-compatibility reason to insist on Signal's own code specifically. The real choice was never "official Signal crypto vs. homegrown" — it was "an unaudited, unofficial fork of Signal's code" vs. "audited primitives + a protocol layer we wrote, can read line-by-line, and can name every line against the published spec." Given nothing here has shipped to a real user yet, owning the smaller, reviewable surface won over depending on an obscure repo. `apps/web/lib/e2e/crypto/{primitives,x3dh,double-ratchet,engine}.ts` implement this, field-named to match [signal.org/docs/specifications/x3dh](https://signal.org/docs/specifications/x3dh) and [.../doubleratchet](https://signal.org/docs/specifications/doubleratchet) directly for auditability.

**What this costs, stated plainly:** this protocol implementation has never been executed — `apps/web` has no test runner, so there is no automated (or even one-off manual) proof that `encrypt` → `decrypt` round-trips correctly. It has been written carefully against the spec and reviewed by re-reading against it, which is a real but strictly weaker guarantee than "this ran and passed." Tracked as an open item, not swept under the "it's done" label.

### 2. Key material — new tables

Both live in the existing `chat` Postgres schema (`chatSchema.table(...)`, same as `conversations`/`messages`) — this key material exists only to serve `ChatModule`'s encryption, same ownership logic as the rest of the module.

```ts
// apps/backend/src/db/schema/chat.schema.ts — additions

export const userE2eIdentities = chatSchema.table("user_e2e_identities", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  identityKey: text("identity_key").notNull(), // base64 X25519 public key (DH)
  // base64 Ed25519 public key — signs signedPrekeyPublic. Separate from
  // identityKey per decision #9: X3DH needs the identity key to both DH
  // and sign, and @noble/curves doesn't expose the curve conversion
  // Signal's XEdDSA uses to make one key do both.
  identitySigningKey: text("identity_signing_key").notNull(),
  registrationId: integer("registration_id").notNull(), // Signal per-installation id
  signedPrekeyId: integer("signed_prekey_id").notNull(),
  signedPrekeyPublic: text("signed_prekey_public").notNull(), // base64
  signedPrekeySignature: text("signed_prekey_signature").notNull(), // base64
  signedPrekeyCreatedAt: timestamp("signed_prekey_created_at", {
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userE2eOneTimePrekeys = chatSchema.table(
  "user_e2e_one_time_prekeys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    prekeyId: integer("prekey_id").notNull(),
    publicKey: text("public_key").notNull(), // base64
    usedAt: timestamp("used_at", { withTimezone: true }), // null = available
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("user_e2e_otp_user_prekey_uq").on(t.userId, t.prekeyId),
    index("user_e2e_otp_available_idx")
      .on(t.userId)
      .where(sql`used_at is null`),
  ],
);
```

- **Private keys never reach the server.** Only public keys and signatures are uploaded. `identityKey`/`identitySigningKey`/`signedPrekeyPublic`/one-time public keys are the entirety of what's stored.
- One-time prekeys are consumed exactly once: claiming a bundle atomically marks one row used (`UPDATE ... SET used_at = now() WHERE id = (SELECT id FROM user_e2e_one_time_prekeys WHERE user_id = $1 AND used_at IS NULL LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`) — same `SKIP LOCKED` claim pattern the payment module's outbox already uses. **Shipped** in `E2eKeysService.getBundle`; the concurrency guarantee itself (two simultaneous claims never grab the same row) is still unverified by a real-Postgres integration test — see Risks.

### 3. New endpoints — shipped, `apps/backend/src/chat/e2e/`

```
POST /api/v1/chats/e2e/keys
  Body: { identityKey, identitySigningKey, registrationId, signedPrekeyId,
          signedPrekeyPublic, signedPrekeySignature,
          oneTimePrekeys: [{ prekeyId, publicKey }, ...] }
  Upserts the identity row (onConflictDoUpdate on userId — a re-registration
  rotates the signed prekey); inserts new one-time prekeys, ignoring any
  (userId, prekeyId) already present (onConflictDoNothing).

GET /api/v1/chats/e2e/keys/:userId/bundle
  Returns: { identityKey, identitySigningKey, registrationId, signedPrekeyId,
             signedPrekeyPublic, signedPrekeySignature,
             oneTimePrekey: { prekeyId, publicKey } | null }
  403s if either user has blocked the other (shared isBlockedEitherWay,
  same as sendMessage) — without this, a blocked user could still enumerate
  whether their target has E2E enabled and burn through their one-time
  prekey pool for a session that could never send a message anyway.
  Otherwise atomically claims and marks one one-time prekey used. A null
  oneTimePrekey means the pool is exhausted — X3DH can still proceed using
  the signed prekey alone; the client should nudge that user to reconnect
  and replenish soon after.

GET /api/v1/chats/e2e/keys/me/prekey-count
  Returns: { available: number }
  Client polls this occasionally (e.g. on app foreground) and calls
  POST .../keys again with a fresh batch when it drops below a threshold
  (suggest 10 — matches typical Signal client defaults).
```

All three are JWT-protected, no new auth pattern needed.

### 4. Message envelope — schema change (shipped)

```ts
// messages table additions
isE2e: boolean('is_e2e').default(false).notNull(),
e2eHeader: jsonb('e2e_header').$type<E2eHeader | null>(),
```

```ts
type E2eHeader = {
  v: 1;
  dh: string; // base64 — sender's current ratchet public key
  pn: number; // previous sending chain length
  n: number; // message number in the current sending chain
  // Present only on the first message of a new session (X3DH initial message):
  identityKey?: string;
  ephemeralKey?: string;
  oneTimePrekeyId?: number;
  signedPrekeyId?: number;
};
```

- `body` keeps its `text` type and now holds base64 ciphertext when `isE2e = true`; unchanged (plaintext) for legacy rows and for any client that hasn't adopted E2E.
- **`messages_body_length_max` raised for the E2E path — shipped at `char_length(body) <= 24000`**, applied uniformly rather than branching the constraint on `is_e2e` (a generous cap on legacy plaintext rows costs nothing). Provisional pending the real measurement checklist below.
- No `conversations`-level "this pair is E2E" flag. E2E-ness is decided per message by whether the sender has a session (or can establish one via X3DH) with the recipient — a conversation can contain a run of plaintext messages followed by a run of E2E ones once both sides adopt it. The client renders per-message based on `isE2e`, not per-thread.

### 5. Session establishment (client-side only — no new backend concept)

First message to a contact with no existing session: client fetches `GET .../keys/:userId/bundle`, runs X3DH, sends the message with a full `e2eHeader` (identity/ephemeral/prekey ids included). Every message after that only carries `{ dh, pn, n }` — the ratchet is already established. All of this state lives in the client's local key storage; **the server never sees, stores, or is involved in ratchet state** beyond relaying the header alongside the ciphertext body, exactly like it relays the body itself.

If the recipient has never registered E2E keys (hasn't opened an E2E-capable client build yet), `GET .../keys/:userId/bundle` 404s. **Settled (decision #6): fail closed** — the send is refused with a clear error, no plaintext fallback and no silent queue-and-retry. See design §9 for why the dev-stage bootstrap flow makes this case rare by construction.

### 6. `SendMessageDto` change (shipped)

```ts
export class SendMessageDto {
  recipientId: string;
  body?: string; // ciphertext (base64) when e2eHeader is present, plaintext otherwise
  listingId?: string;
  imagePath?: string;
  e2eHeader?: E2eHeaderDto; // new, optional — absence = legacy plaintext send
}
```

`ChatService.sendMessage` sets `isE2e = Boolean(dto.e2eHeader)` and stores the header verbatim. It additionally rejects `e2eHeader` combined with `imagePath` (400) — E2E is text-only in v1 (decision #3), so mixing an encrypted body with a plaintext image in one message is disallowed rather than silently permitted. No other validation of header contents server-side — the server cannot and should not attempt to understand ratchet state; malformed headers are a client-side decryption failure, not a server error.

### 7. WebSocket gateway — no changes needed (confirmed)

`chat.gateway.ts`'s `send_message` event already forwards the full DTO into `ChatService.sendMessage`. `e2eHeader` rides along for free. This is the one place the module's existing "one write path, REST or WS" design (documented in `chat/README.md`) pays off directly for this feature — zero WS-specific crypto work.

### 7b. Realtime hint for the backup (2026-10-26)

The one backup event (`e2e.backup_updated`, fired when another device uploads segments) rides the same
`notification` frame as any other push, to the user's own tabs only, with ids and no ciphertext. It replaces the
old 60 s backup pull while the socket is up; the poll stays as a 5-minute safety net and as the fallback when the
socket is down. Contract and delivery rules: `apps/backend/src/chat/README.md`. Device approval was removed the
same day — the backup passcode is the only way a new device obtains the backup key.

### 8. Client-side key storage

- Identity keypair (now: keypairs, plural — decision #9) generated on first use of the feature, stored locally (native app: platform keystore/secure enclave; web: IndexedDB — accepted as weaker, see Risks).
- Private keys never serialize into any network request, ever.
- Losing local storage (logout+reinstall, cleared browser data) means losing the ability to decrypt that device's history — by design (single-device model). New session generates a fresh identity and starts fresh handshakes with contacts.
- **Built:** the ratchet-session half of local storage (`apps/web/lib/e2e/store.ts` — IndexedDB, sessions keyed by conversation, decrypted plaintext keyed by message id) and the reliability layer around it (`decrypt-message.ts`, `lock.ts`).
- **Not built:** the long-term-key half. `createSignalEngine()` (`crypto/engine.ts`) takes a `LocalKeyMaterial` object (identity keypair, a way to look up a signed prekey or one-time prekey by id) as a constructor argument — deliberately, so the engine stays ignorant of where that material is generated or persisted. Nothing currently implements `LocalKeyMaterial`; no code generates an identity keypair, stores one, or calls `POST /chats/e2e/keys`. This is exactly design §9's bootstrap flow, still entirely on paper.

### 9. Client-side key bootstrap (login flow) — settled

Resolves the "old user with no registered identity" case. The check is **local, not server-side** — the server cannot tell a client "you need keys," it can only be the thing keys get uploaded to.

```text
App boots, session valid (post login / register / refresh)
        |
        v
Check local secure storage for an identity keypair
belonging to (this account, this install)
        |
   +----+----+
   |         |
 found    not found
   |         |
 done   generate, entirely client-side:
         - identity keypair (X25519, for DH)
         - identity signing keypair (Ed25519 — decision #9)
         - signed prekey (X25519, signed by the identity SIGNING key)
         - one-time prekey batch (100 — see below)
         |
         v
   POST /chats/e2e/keys  (public halves only — private keys never leave the device)
         |
         v
   E2E sending unlocked (near-instant local keygen — not a network wait;
   old plaintext history stays readable throughout, ungated)
```

**The server never generates keys.** Any design where the backend touches private key material has already failed at end-to-end encryption — full stop, no exceptions considered.

**Sharp edge, stated explicitly so it isn't rediscovered mid-implementation:** identity is per-_account_, not per-_device_ (decision #2 — single device, v1). A second device logging in **overwrites** the server's identity record for that user (`onConflictDoUpdate` on `userId`, per the endpoint design above). This silently invalidates any session the first device had established with its contacts — their next message to this user triggers a fresh X3DH handshake against the new identity, because the old one no longer resolves. This is the single-device model working as designed, not a bug, but it is a real, visible behavior change for a user who logs into a second device, so client UX should say something (e.g. "signing in here starts fresh secure sessions with your contacts") rather than let it happen invisibly.

**Fail-closed on missing recipient keys (decision #6):** if `GET .../keys/:userId/bundle` 404s (recipient's client hasn't bootstrapped yet), the sender's client refuses the E2E send with a clear error — no plaintext fallback, no silent queue-and-retry. Dev-stage, this is easy: every test client can be forced through the bootstrap flow above before it's usable at all, so the 404 case becomes rare by construction rather than something to design a fallback UX around.

### 9b. Key availability — a chat partner is never "not set up yet" (2026-10-27)

End-to-end encryption is unchanged and strict (decision #6: no plaintext fallback, the server never holds a
body it can read). What changed is that an account that has signed in is always reachable, and the sender
no longer sees "ask them to open Messages once".

1. **Registration invariant.** Every successful sign-in registers this browser as a device straight away:
   `bootstrapE2eAfterAuth` (`apps/web/lib/e2e/bootstrap-after-auth.ts`) runs after a password login and
   after an OTP verify (login and registration). Measured in a fresh browser profile: the device row exists
   ~0.75 s after submit, before the redirect, with no reload. `E2eBackupProvider` remains the safety net.
2. **Targetability rule** (`loadTargetDevices`, `apps/backend/src/chat/e2e/e2e-devices.util.ts`). Per user:
   the non-revoked devices seen within `DEVICE_STALE_DAYS` (30); if there are none, the
   `STALE_FALLBACK_DEVICES` (2) most recently seen non-revoked devices. The devices list, the bundle fetch
   and both send-path set checks all call it, so the sender's envelope set and the server's expected set
   cannot disagree. A user with at least one non-revoked device is therefore always targetable.
   **Limit:** a message to a stale device is readable only if the person comes back on that same browser; a
   different browser or cleared data is a new device with no envelope for it (only the history backup helps).
3. **Staying fresh.** The leader tab re-runs the device heartbeat and prekey top-up about every 6 h and on
   becoming visible after a long gap (`heartbeat-schedule.ts`). After the first bootstrap the browser is
   asked for persistent storage (`navigator.storage.persist()`), since identity keys live only in
   IndexedDB. Consecutive bootstrap failures are counted (`bootstrap-health.ts`) and one dismissible notice
   appears in the chat column after two in a row (storage blocked vs other).
4. **A recipient with no device at all** (never signed in on an E2E build). The sender **holds** the sealed
   message locally (`held-sends.ts`, IndexedDB `npic-e2e-held-sends`, glue in `held-sends-runtime.ts`):
   - the bubble reads "Waiting for <name> to join secure chat. It will send automatically." with Cancel;
   - it is retried when the thread opens and by one app-wide loop that exists only while something is held
     (30 s, doubling to 2 min; leader tab, visible tabs only); a send happens at most once (per-recipient
     Web Lock plus a re-read before each send, and the server dedups on `clientMessageId`);
   - after 14 days, or on a permanent 4xx error, it becomes a visible "not sent" row with Remove;
   - encrypted-attachment sends use the same hold through the attachment outbox.
5. **Nudge.** The first held message for a recipient calls `POST /chats/e2e/nudge/:userId`: JWT, 404 unknown
   user, 403 when either side blocked the other, a no-op when this sender already nudged this recipient in
   the last 24 h (checked against the `notifications` table, no migration). It creates an in-app
   notification `chat.e2e_nudge` with a fixed title (or the title of an optional attached listing) and no
   body. **No Telegram delivery yet**: the codebase has no Telegram messaging channel (Telegram is login only).

**Residual limits.** Held plaintext sits in the sender's IndexedDB until sent, cancelled or expired (the
same exposure as the decrypted-message cache). The nudge reveals that someone wants to talk, never what
they said. A held message survives only as long as the sender's browser profile does.

### 9c. History availability (2026-10-27)

A message is readable on a device only if (a) it carries an envelope for that device, or (b) some device of
the account decrypted it while holding the backup key and uploaded it. Private keys, ratchet sessions and the
backup key never reach the server in the clear. Device-to-device approval no longer exists: the backup
passcode is the only way to unlock the backup key on a new device.

1. **Catch-up decrypt** (`hooks/use-e2e-catch-up.ts`, `lib/e2e/catch-up.ts`, resume marks in the IndexedDB
   `npic-e2e-catchup`). A signed-in tab that is **not** on `/chats` still decrypts incoming messages and
   caches the plaintext, so (b) covers every message a device _received_, not only those it displayed. It
   runs in one visible leader tab per browser, oldest first per conversation, in pages of 100 with a
   200-message budget per tick, never advances a ratchet twice (the decrypt cache makes a re-run a no-op),
   and runs whether the backup is locked or unlocked (the plaintext is uploaded once the device holds the
   key). Triggers: a socket push, then a safety tick every 5 min (2 min without a socket).
2. **Unavailable messages are one notice, not a wall.** A run of consecutive messages this device has no
   envelope for renders as a single row with a count (`lib/chat/group-unavailable.ts`; a readable message
   splits a run, own sent rows group like any other). Its text depends on the backup state: _locked with a
   passcode_ ("Enter your backup passcode to see these N messages", with an inline button), _ready_ ("not in
   your backup: sent before this device joined and none of your devices had opened it"), or _locked, no
   passcode_ ("set a passcode on the device that has your history"). The "ready" state says honestly that
   passcode entry cannot help.
3. **Passcode prompt.** Opening a thread that has unavailable messages on a locked device with a passcode
   opens the passcode dialog every time; "Not now" silences it for the browser session
   (`sessionStorage` key `chat:e2e-restore-snoozed`), and the inline button or the chat banner reopens it.
4. **Flush on hide.** The leader tab uploads pending plaintext when the tab becomes hidden
   (`visibilitychange`); `pagehide` is only a best-effort second chance, because the browser can kill the
   request on a real close.

**Limit.** A message that **no** device ever received while signed in cannot be recovered by anyone. The "ready"
notice says so instead of pointing at a passcode that cannot help. Resetting a forgotten or missing passcode
(decision D1 in `Plans.md`) is not implemented.

## Deciding the numeric parameters — two different methods, bucketed by what the number actually depends on

Don't treat every unresolved constant the same way. Split them by whether the right answer depends on **this app's content/traffic** or on **X3DH/Double Ratchet protocol mechanics that don't care whose app it is**:

- **Content/traffic-dependent (e.g. `messages_body_length_max`) → measure, don't guess, and don't block on it.** The real answer needs a real ciphertext sample from the actual library, which isn't installed yet. Ship a generous provisional value now (24000 — covers a worst-case 4000-char multibyte Khmer/Chinese message through AES-GCM + base64 expansion, computed on paper) and track the real measurement as a concrete pre-release checklist item (below), not an open-ended question that quietly never gets revisited.
- **Protocol-mechanics-dependent (e.g. prekey pool size, replenish threshold, skipped-message-key cap) → adopt the reference implementation's tuned defaults now, as final.** These numbers govern "how many strangers can X3DH-handshake with you before you need to top up," which is a function of the protocol, not of npic's user count. Signal already tuned this against a far larger population running the identical mechanic — re-deriving it from scratch here risks the same class of mistake as hand-rolling the ratchet itself (decision #1's reasoning, one level up the stack). Adopted: **100 initial one-time prekeys, replenish below 10 remaining**, skipped-message-key cap = **1000** (`MAX_SKIP` in `double-ratchet.ts`) — matches Signal's own reference implementation; don't override without a measured incident.

**Pre-release checklist (blocks final ship, not the initial implementation pass):**

1. Once `createSignalEngine` has a real `LocalKeyMaterial` source (i.e. once the bootstrap flow above exists), encrypt representative 4000-character samples in `en`, `km`, and `zh` (the app's supported scripts — byte length per character varies a lot between them).
2. Base64-encode each ciphertext, record the longest result.
3. Set `messages_body_length_max` to that measured max + ~15-20% margin, replacing the provisional 24000. Adjust the DB check constraint via a follow-up migration if the measured value differs meaningfully.

## Resolved since first draft

| #        | Was                                                                                           | Now                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~OQ-1~~ | Recipient has no registered E2E keys yet — queue-and-retry, or fall back to plaintext?        | **Settled: fail closed, no fallback** (decision #6, design §9). Dev-stage forced-bootstrap-at-login makes the 404 case rare by construction.                                                              |
| ~~OQ-2~~ | Exact `messages_body_length_max` replacement value                                            | **Provisional 24000, real value gated on a pre-release measurement checklist** (decision #8, "Deciding the numeric parameters"). Not open-ended — has a concrete trigger to close it out.                 |
| ~~OQ-3~~ | One-time prekey pool size and replenishment threshold                                         | **Settled: 100 initial / replenish under 10**, Signal's own defaults adopted outright (decision #7). Protocol-mechanics constant, not npic-specific — no further research needed.                         |
| ~~OQ-6~~ | Which crypto library — `@signalapp/libsignal-client` as planned?                              | **Rejected on implementation** — no official browser/WASM build exists. Resolved to a from-spec X3DH + Double Ratchet implementation over `@noble/curves`/`@noble/ciphers`/`@noble/hashes` (decision #1). |
| ~~OQ-7~~ | Can one identity key both DH and sign, per the original schema (single `identityKey` column)? | **No** — resolved by splitting into `identityKey` (X25519) + `identitySigningKey` (Ed25519), decision #9, migration `0018`.                                                                               |

## Open questions (genuinely undecided)

| #    | Question                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-4 | Web private-key storage (IndexedDB) is weaker than a native secure enclave                    | Accepted risk for the web client specifically, called out again in Risks — revisit if a native app ships and the web surface's threat model needs to match it.                                                                                                                                                                                                                                  |
| OQ-5 | Should `isE2e` ever become a per-conversation flag instead of per-message?                    | Only if the UI needs "this whole thread is secure" framing rather than per-bubble indicators. No backend blocker either way — the column exists per-message regardless.                                                                                                                                                                                                                         |
| OQ-8 | The X3DH/Double Ratchet implementation has never been executed — no test runner in `apps/web` | Written carefully against the published spec and field-named for line-by-line auditability, but "reviewed by re-reading" is not "ran and passed." Needs either a minimal test runner added to `apps/web`, or a one-off manual encrypt→decrypt round-trip script, before this touches a real key. Not blocking further scaffolding work, but should block actually enabling E2E for a real user. |
| OQ-9 | Where does `LocalKeyMaterial` come from?                                                      | `createSignalEngine()` needs a device's own identity/signing/signed-prekey/one-time-prekey material injected — nothing generates, persists, or registers it yet. This is design §9 made concrete: needs its own implementation pass (key generation, an IndexedDB store for private material distinct from `store.ts`'s ratchet-session store, and the `POST /chats/e2e/keys` caller).          |

## Risks

| Risk                                                                                                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web client's private key lives in IndexedDB — extractable via XSS or physical device access to an unlocked browser profile | Documented, accepted for v1 (OQ-4). Standard mitigation (CSP hardening) applies but doesn't eliminate the gap; a native app closes it properly via platform keystore.                                                                                                                                                                                                                                                                                            |
| One-time prekey exhaustion under high fanout (many people starting sessions with one popular seller account)               | Pool size/replenish threshold now settled (100 / <10, decision #7) — `GET .../keys/me/prekey-count` drives client-side top-up before hitting zero; falling back to signed-prekey-only X3DH is a graceful degradation, not a hard failure. Revisit the 100/10 numbers only if a specific hot-account pattern measurably exhausts the pool faster than a client can top up.                                                                                        |
| Skipped-message-key growth if a peer is offline a long time then reconnects                                                | `double-ratchet.ts`'s `MAX_SKIP = 1000` bounds this directly (our own implementation now, not a library default) — a gap larger than that throws rather than allocating unboundedly.                                                                                                                                                                                                                                                                             |
| `messages_body_length_max` provisional value (24000) is wrong in either direction                                          | Closed out by the pre-release measurement checklist (decision #8) — not left as an indefinite open question. Ship the provisional value now, replace it once the real ciphertext measurement exists.                                                                                                                                                                                                                                                             |
| A future "report this message" feature gets built without realizing content is opaque past this point                      | Called out explicitly in Non-goals / server-gives-up section so it's not rediscovered mid-implementation of that future feature.                                                                                                                                                                                                                                                                                                                                 |
| Second-device login silently invalidates the first device's established sessions                                           | Not a bug (single-device model, decision #2) but needs explicit client UX, not silence — called out in design §9.                                                                                                                                                                                                                                                                                                                                                |
| **The X3DH/Double Ratchet implementation is our own code, not a vetted library's** (decision #1 pivot)                     | Mitigated, not eliminated: implemented directly from the published, peer-reviewed spec rather than invented; field-named to match the spec for line-by-line audit; every cryptographic primitive (curve math, AEAD, KDFs) is delegated to audited libraries — only the protocol _sequencing_ is ours. Still real residual risk versus a library with its own security audits and years of production traffic. OQ-8 (never executed) compounds this until closed. |
| One-time prekey exhaustion via the bundle endpoint's block-check gap                                                       | **Fixed** — `getBundle` now checks `isBlockedEitherWay` before claiming a prekey, closing the enumeration/exhaustion vector a blocked user previously had.                                                                                                                                                                                                                                                                                                       |
