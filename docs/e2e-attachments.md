# E2E Attachments — design (encrypted images/files, private bucket, signed URLs)

> Design reference (moved from `tasks/plan-e2e-attachments.md` on 2026-10-24). §4 defines the frozen `E2E_FILE_V1` format, and §4/§5 are cited from code. The phase checklist and test plan were dropped once everything shipped (they are in git history); the section numbers are kept so those citations still resolve.

**Status (2026-10-24):** P1–P4 complete and browser-verified end to end on 2026-10-24: v2 text, image, voice note and location card across two live accounts. The migration landed as `0030_flimsy_shadow_king` (written below as `0026`, before the renumbering). Shipped in `e222daa`/`28e1d37`/`72d5102`; recorded in `CHANGELOG.md`. D12 is superseded.

**Original status:** P1 (backend) done 2026-09-29 — migration `0026`, bucket `chat-files` created on the dev project. P2 (web send) + P3 (web receive) done 2026-09-29, not yet browser-tested end to end. P4 done: hourly BullMQ `attachments-cleanup` (job scheduler upsert, boot never blocked), CLAUDE.md + chat README updated.

**Deviations:** inbox uses `lastMessage.attachments` (already on every message read) instead of a separate `attachmentCount`. The web crypto round trip was checked with a throwaway Node script (8 checks: size, header, round trip, tampered byte, wrong attachment id, unknown version, forged hash + tampered tag, fresh key/IV), not vitest.

**Verified against real storage (2026-09-29):** octet-stream upload 200; `info(path)` returns the real size (1234 → 1234); `text/html` upload refused (415 `invalid_mime_type`); public URL refused (400); signed download 200; `info` on a missing object → `data: null` + error.
**Depends on:** E2E v2 multi-device (`tasks/plan-e2e-multi-device.md`). Attachments ship on the v2 send path only.
**Goal:** chat images and files get the same protection as chat text: the server, the storage bucket, and anyone holding a URL see only ciphertext. Delivery must survive retries, reloads and crashes without broken messages or orphaned files. Files must be small.
**Non-goals (V1):** chunked/streaming encryption, resumable (TUS) upload, compressing arbitrary files, virus scanning, CDN, migrating old public `imageUrl` images.

---

## 1. Decisions

| #   | Decision                                                                                                                       | Why                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | New `chat.attachments` table with an explicit state machine `pending → uploaded → attached` (+ `expired`)                      | Upload and message send are separate steps; the DB must know which blobs exist, which are referenced, and which are orphans.                                                                                            |
| D2  | **Single-shot AES-256-GCM** per file via WebCrypto. No chunking in V1                                                          | ≤ 25 MB fits in memory; native and fast. Avoids a home-made chunk format. If streaming is needed later, use a published scheme (Tink streaming AEAD / STREAM), never a custom one.                                      |
| D3  | Random key per file; key + `ciphertextHash` + all file metadata travel **inside the E2E message**                              | Server never sees keys, MIME types or names. Every device of both users (and restored backups) can open the file with no extra work.                                                                                    |
| D4  | Each file encrypted independently; one E2E message may carry up to **10** attachments                                          | Independent download/retry/cache per file. Limit of 10 keeps the encrypted body under the 24,000-char cap (thumbnail ≈ 1 KB each).                                                                                      |
| D5  | Private bucket, server-generated object key, **short-lived signed download URLs** issued only to conversation participants     | No public URLs. A leaked signed URL works ≤ 5 min and yields ciphertext only.                                                                                                                                           |
| D6  | Server never trusts the declared size: `complete` reads the real object size; bucket `file_size_limit` = 25 MB is the hard cap | Supabase signed upload URLs can't cap size per URL and aren't single-use.                                                                                                                                               |
| D7  | Client-generated attachment UUID is the primary key                                                                            | Idempotent create: a retry returns the same row, no duplicates. Same idea as `clientMessageId`.                                                                                                                         |
| D8  | Attach inside the message insert transaction with one conditional `UPDATE … RETURNING`                                         | Atomic under concurrency; a message can never reference a missing, foreign or already-used file.                                                                                                                        |
| D9  | **No outbox**                                                                                                                  | The chat module deliberately skips the outbox: REST is authoritative and delta polling guarantees delivery (see `src/chat/README.md`).                                                                                  |
| D10 | Hourly BullMQ repeatable job cleans `pending`/`uploaded` rows unattached after 24 h                                            | Covers upload failures and "uploaded, then the browser crashed before sending". First BullMQ use in chat; the Redis/BullMQ infra already exists (`app.module.ts`).                                                      |
| D11 | Resize/re-encode images to WebP in a Web Worker **before** encrypting                                                          | 3–6 MB phone photos → 200–400 KB; strips EXIF/GPS; encrypted data can't be compressed afterwards.                                                                                                                       |
| D12 | Kill switch `NEXT_PUBLIC_E2E_ATTACHMENTS=off` falls back to the legacy `imagePath` send                                        | Same pattern as `NEXT_PUBLIC_E2E_V2`. **Superseded 2026-10-24:** the backend now rejects `imagePath`, so the switch fails closed (media sends fail visibly) instead of falling back.                                    |
| D13 | `attachments.message_id` is `ON DELETE SET NULL`, and cleanup also removes `attached` rows whose message is gone               | Messages have no delete endpoint today, but a message row can still disappear (e.g. a future hard delete). The row must survive to tell cleanup which storage object to remove; CASCADE would silently leak the object. |

---

## 2. Data model

```ts
// src/db/schema/chat.schema.ts
export const attachmentStatusEnum = chatSchema.enum("attachment_status", [
  "pending",
  "uploaded",
  "attached",
  "expired",
]);
export const attachmentKindEnum = chatSchema.enum("attachment_kind", [
  "image",
  "file",
]);

export const chatAttachments = chatSchema.table(
  "attachments",
  {
    id: uuid("id").primaryKey(), // client-generated (D7)
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SET NULL on purpose (D13): the row must outlive a deleted message so
    // cleanup still knows the object key. CASCADE would delete the row and
    // leak the storage object, since Postgres can't delete from the bucket.
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    objectKey: text("object_key").notNull(), // `{uploaderId}/{id}` in CHAT_FILES_BUCKET
    kind: attachmentKindEnum("kind").notNull(),
    status: attachmentStatusEnum("status").notNull().default("pending"),
    declaredSize: integer("declared_size").notNull(), // client claim, informational
    actualSize: integer("actual_size"), // set by `complete` from storage metadata
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    attachedAt: timestamp("attached_at", { withTimezone: true }),
  },
  (t) => [
    index("attachments_message_idx").on(t.messageId),
    index("attachments_orphan_idx")
      .on(t.createdAt)
      .where(sql`message_id is null`),
    index("attachments_uploader_created_idx").on(t.uploaderId, t.createdAt), // quota
  ],
);
```

Deliberately **not** stored server-side: MIME type, file name, content hash, dimensions. They live in the encrypted metadata (D3). The server can't compute a sha256 of the object anyway.

> **Invariant: storage integrity is recipient-verified, not server-verified.** The server only checks that an object exists and its size. That the object is exactly the ciphertext the sender described is proven by the recipient (`ciphertextHash` + the GCM tag). This is why there is no `content_hash` column.

State machine:

```
pending ──complete (size ok)──▶ uploaded ──POST /messages──▶ attached
   │                               │
   └───── 24 h, no message ────────┴──────▶ (object + row deleted by cleanup)
complete with size > limit ──▶ expired (object deleted immediately)
```

---

## 3. API

All routes JWT-protected, under `/api/v1/chats`.

### `POST /chats/attachments`

`{ id: uuid, kind: 'image'|'file', declaredSize: int }` → `{ id, uploadUrl, token, expiresAt }`

- `declaredSize` ≤ per-kind limit (image 10 MB, file 25 MB), else 400.
- Idempotent: an existing row with the same `id` **and** same uploader → re-issue a signed upload URL for the same `objectKey` (only while `pending`). Same `id`, different uploader → 409.
- Quota: sum of `declared_size` for this uploader in the last 24 h + this one ≤ `CHAT_ATTACHMENT_DAILY_BYTES` (default 200 MB), else 429 `ATTACHMENT_QUOTA_EXCEEDED`.
- `@Throttle` 60/min.
- Signed upload URL via `FilesService.createSignedUploadUrl` on `CHAT_FILES_BUCKET`, object key `{uploaderId}/{id}` (server-generated, never the client's file name).

### `POST /chats/attachments/:id/complete`

→ `{ id, status: 'uploaded', actualSize }`

- Own + `pending` only (idempotent if already `uploaded`).
- Reads object metadata from storage. Missing → 409 `ATTACHMENT_NOT_UPLOADED`. Size > kind limit → delete object, `expired`, 400.
- Sets `actualSize`, `uploadedAt`, `status='uploaded'`.

### `POST /chats/messages` (extended)

New optional field `attachmentIds: uuid[]` (max 10, unique).

- Requires the v2 `e2e` envelope (text-free attachment messages still carry an encrypted body with the metadata); rejects `imagePath` together with `attachmentIds`.
- Inside the existing insert transaction, after inserting the message:
  ```sql
  update chat.attachments
     set status = 'attached', message_id = $messageId, attached_at = now()
   where id = any($ids) and uploader_id = $senderId
     and status = 'uploaded' and message_id is null
  returning id;
  ```
  Returned count ≠ `ids.length` → roll back, 400 `ATTACHMENT_INVALID` (details: which ids).
- `clientMessageId` replay returns the original message (already handled) and must not re-run the update.

### `POST /chats/attachments/sign`

`{ ids: uuid[] }` (max 50) → `[{ id, url, expiresAt }]`

- One query: attachments joined to `messages` → `conversations`; caller must be a participant and the attachment `attached`. Unauthorized ids are silently omitted (no existence oracle, same as conversation 404s).
- `FilesService.createSignedDownloadUrl(CHAT_FILES_BUCKET, objectKey, 300)`.

### Message reads

`MessageWithListing` gains `attachments: { id: string; kind: 'image'|'file' }[]` (batch-loaded per page with `inArray`, per the batch-lookup pattern). Inbox `lastMessage` gains `attachmentCount`.

---

## 4. Crypto spec (client)

```
key        = crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt'])
header     = 0x4E 0x50 0x46 0x01                           // "NPF" magic + version 1 (4 bytes)
iv         = 12 random bytes
aad        = header || utf8("npic-chat-file-v1:" + attachmentId)
ciphertext = AES-GCM(key, iv, plaintextBytes, aad)        // includes 16-byte tag
blob       = header || iv || ciphertext                    // what gets uploaded
ciphertextHash = base64(sha256(blob))
```

**Frozen V1 file format (`E2E_FILE_V1`):**

```
┌──────────────────┬──────────┬──────────────────────────────┐
│ "NPF" + 0x01 (4B)│ IV (12B) │ ciphertext + GCM tag (N+16B) │
└──────────────────┴──────────┴──────────────────────────────┘
```

- Overhead: 32 bytes per file. `ciphertextSize = plaintextSize + 32`.
- Readers check the magic and version first; an unknown version is rejected, never guessed. A future chunked format ships as version `0x02` with its own spec.
- The header is part of the AAD, so the version byte can't be swapped without failing the tag.
- The attachment id in the AAD binds each blob to its own attachment record.
- Decrypt order: download → `sha256(blob) == ciphertextHash` (reject before any decrypt) → AES-GCM decrypt (tag verifies) → render.
- Never reuse a key: one key per file, generated fresh; the IV is random per encryption.

### Encrypted message content

Text-only messages stay a plain string (no change). A message with `attachments.length > 0` in the server response has JSON plaintext:

```jsonc
{
  "v": 1,
  "text": "optional caption",
  "attachments": [
    {
      "id": "uuid", // matches server attachment id
      "kind": "image",
      "mime": "image/webp",
      "name": "IMG_2031.webp", // files only
      "key": "base64 raw AES key",
      "ciphertextHash": "base64 sha256",
      "ciphertextSize": 312045,
      "plaintextSize": 312017,
      "w": 2048,
      "h": 1536, // images only
      "thumb": "base64 webp ~32px", // images only, ≤ 1.5 KB
    },
  ],
}
```

The client parses JSON only when the server says the message has attachments, so old plain-string messages never get misread. The backup (`lib/e2e/backup.ts`) stores this plaintext as-is, so restored devices get the keys too.

---

## 5. Client pipeline

### Send (`lib/e2e/attachments/`)

1. **Prepare** (Web Worker): decode → resize longest edge to 2048 px (4096 for an "HD" option) → WebP quality 0.8 → 32 px thumbnail. Files: as-is, no compression.
2. **Encrypt** (D2 spec) and hash.
3. **Persist** the draft (encrypted blobs + metadata + `clientMessageId` + attachment ids) in an IndexedDB outbox store, so a reload resumes instead of losing the send.
4. **Upload** per attachment: `POST /attachments` → `PUT uploadUrl` (`application/octet-stream`) → `POST /attachments/:id/complete`. Retries reuse the same ids. Behind an `AttachmentUploader` interface (`create/upload/complete`) with only `DirectUploader` in V1.
5. **Send** after every attachment is `uploaded`: `sendE2eText` with the JSON content + `attachmentIds`. Clear the outbox entry on success.
6. On a failure after retries, the bubble shows "failed, tap to retry"; nothing half-sent reaches the peer.

### Receive / render

1. Decrypt the message → render the thumbnails immediately (blurred, correct aspect ratio from `w/h`).
2. Visible attachments → one batched `POST /attachments/sign` per page; cache signed URLs until `expiresAt − 30 s`; re-sign on 403.
3. Fetch → verify hash → decrypt → `URL.createObjectURL`; revoke on unmount.
4. Cache decrypted bytes in IndexedDB (`npic-e2e-files`, keyed by attachment id), LRU-capped at ~200 MB.
5. Inbox preview: "📷 Photo" / "📎 File" from `attachmentCount`, caption if any.

---

## 6. Cleanup and limits

- BullMQ queue `chat-maintenance`, repeatable job `attachments-cleanup` every hour:
  `message_id is null and ((status in ('pending','uploaded','expired') and created_at < now() - 24h) or status = 'attached')` → the second branch catches files whose message was deleted (D13). Delete storage objects in batches of 100, then delete those rows. Deleting an already-missing object is fine, so reruns are harmless.
- Limits: image 10 MB, file 25 MB, 10 attachments per message, 200 MB per user per 24 h, create 60/min.
- Config (Zod, optional with defaults): `CHAT_FILES_BUCKET=chat-files`, `CHAT_ATTACHMENT_DAILY_BYTES=209715200`.
- Supabase dashboard (manual, once per environment): create bucket `chat-files`, **public off**, `file_size_limit` 25 MB.

---

## 7. Compatibility

- Legacy image messages (`imageUrl`/`imagePath`, public bucket) keep rendering unchanged. Not migrated in V1.
- v1 E2E and plaintext senders can't attach files; with the kill switch off or no v2 device, the client falls back to the legacy image send.
- Old clients that don't understand `attachments` see the JSON as text. Acceptable during rollout (all web clients update together); mention in release notes.

---

## 10. Risks

| Risk                                              | Mitigation                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| WebCrypto memory on 25 MB files on low-end phones | Only files are that large; images are ≤ ~400 KB after resize. Chunked streaming is the documented follow-up. |
| Storage abuse                                     | Per-user daily quota, throttle, bucket size cap, 24 h cleanup.                                               |
| Signed URL shared within 5 min                    | Yields ciphertext only; key is in the E2E message.                                                           |
| Old public images remain public                   | Out of scope; separate migration ticket.                                                                     |

## 11. Open questions

1. ~~Which supabase-js call returns object size?~~ Resolved: installed `@supabase/storage-js` 2.108.2 has `storage.from(bucket).info(path)` (returns `size`) and `exists(path)`. Add an `info` wrapper to `SupabaseService`.
2. Content type on signed upload: the client sets it. Plan: set the bucket's `allowed_mime_types` to `['application/octet-stream']` so storage rejects anything else. **Verify in P1** with a real upload using another type (expect a 4xx). `info(path)` size is confirmed from the installed types; also verify it at runtime in P1.
3. Add vitest to `apps/web` for `lib/e2e/**` now?
4. User rows are only soft-deleted, so `uploader_id … cascade` never fires today. If hard delete is ever added, delete the user's objects first.
5. Per-side conversation delete: should attachments of a conversation both sides deleted be cleaned up? (Not in V1.)
