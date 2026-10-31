import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { listings } from './listings.schema';
import { chatSchema } from './chat.pg-schema';

export const conversations = chatSchema.table(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Canonical unordered pair: user_a_id < user_b_id (service sorts before insert)
    userAId: uuid('user_a_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userBId: uuid('user_b_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Denormalized inbox ordering key; bumped on every send.
    // precision 3 (ms): cursors roundtrip through JS Dates, which have no
    // microseconds — full precision would make gt/lt boundary checks drift.
    lastMessageAt: timestamp('last_message_at', {
      withTimezone: true,
      precision: 3,
    })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Per-participant "delete conversation" — hides the thread from ONLY the
    // deleting side's inbox; the row (and the other participant's view of it)
    // survives. Cleared automatically whenever either side sends a new
    // message (see ChatService.sendMessageInternal) or explicitly re-opens
    // the thread via startConversation, so a deleted thread comes back the
    // moment it's relevant again instead of staying hidden forever.
    deletedByUserAAt: timestamp('deleted_by_user_a_at', { withTimezone: true }),
    deletedByUserBAt: timestamp('deleted_by_user_b_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('conversations_pair_uq').on(t.userAId, t.userBId),
    index('conversations_user_a_recency_idx').on(t.userAId, t.lastMessageAt),
    index('conversations_user_b_recency_idx').on(t.userBId, t.lastMessageAt),
    check('conversations_pair_ordered', sql`user_a_id < user_b_id`),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export interface E2eHeader {
  v: 1;
  dh: string; // base64 — sender's current ratchet public key
  pn: number; // previous sending chain length
  n: number; // message number in the current sending chain
  // Present only on the first message of a new session (X3DH initial message):
  identityKey?: string;
  ephemeralKey?: string;
  oneTimePrekeyId?: number;
  signedPrekeyId?: number;
}

export const messages = chatSchema.table(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body'),
    // Client-generated dedup key (e.g. a UUID minted before the send call) so
    // a retried send — WS reconnect racing an ack, a double-tap — replays the
    // original message instead of creating a duplicate. Optional: REST already
    // gets this from IdempotencyMiddleware; this is the WS-path equivalent,
    // and works for REST too if a caller chooses to send it. Scoped to the
    // sender (not global) since IDs are client-minted, not server-issued.
    clientMessageId: text('client_message_id'),
    // Optional listing context card; the card survives listing removal via SET NULL
    listingId: uuid('listing_id').references(() => listings.id, {
      onDelete: 'set null',
    }),
    imageUrl: text('image_url'),
    imagePath: text('image_path'),
    // Links related images (e.g. multiple photos in one send). Null for text messages.
    groupId: uuid('group_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    isE2e: boolean('is_e2e').default(false).notNull(),
    // v1 only: the single-recipient ratchet header. v2 rows keep this null
    // and carry one header per device in message_envelopes instead.
    e2eHeader: jsonb('e2e_header').$type<E2eHeader | null>(),
    // null = plaintext, 1 = v1 (one ciphertext for the recipient's single
    // identity), 2 = v2 multi-device (body encrypted once under a random
    // content key, wrapped per device in message_envelopes).
    e2eVersion: smallint('e2e_version'),
    // v2 only: the device that encrypted this message. Also the AEAD
    // associated data for `body`, so a body can't be replayed under another
    // device's name.
    senderDeviceId: uuid('sender_device_id').references(
      () => userE2eDevices.id,
      { onDelete: 'set null' },
    ),
    // precision 3 (ms): must compare exactly against JS-Date-derived cursors
    // (see conversations.lastMessageAt)
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Serves both the history cursor (DESC) and the after-delta poll (ASC)
    index('messages_conversation_created_idx').on(
      t.conversationId,
      t.createdAt,
      t.id,
    ),
    // Unread counting + mark-read touch only unread rows
    index('messages_conversation_unread_idx')
      .on(t.conversationId, t.senderId)
      .where(sql`read_at is null`),
    index('messages_listing_id_idx').on(t.listingId),
    // Partial: NULLs (the common case — no idempotency key supplied) never
    // collide, so this only ever rejects a genuine retry of the same
    // (sender, clientMessageId) pair.
    uniqueIndex('messages_sender_client_id_uq')
      .on(t.senderId, t.clientMessageId)
      .where(sql`client_message_id is not null`),
    check(
      'messages_content_present',
      sql`body is not null or image_path is not null`,
    ),
    check(
      'messages_image_pair',
      sql`(image_url is null) = (image_path is null)`,
    ),
    check('messages_body_length_max', sql`char_length(body) <= 24000`),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export const userE2eIdentities = chatSchema.table('user_e2e_identities', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  identityKey: text('identity_key').notNull(), // base64 X25519 public key (DH)
  // base64 Ed25519 public key — signs signedPrekeyPublic. Separate from
  // identityKey because X3DH needs the identity key to both DH (X25519) and
  // sign (Ed25519); noble/curves doesn't expose the Edwards<->Montgomery
  // conversion Signal's own XEdDSA uses to make one key do both, and
  // hand-rolling that curve-point conversion isn't worth the risk.
  identitySigningKey: text('identity_signing_key').notNull(),
  registrationId: integer('registration_id').notNull(),
  signedPrekeyId: integer('signed_prekey_id').notNull(),
  signedPrekeyPublic: text('signed_prekey_public').notNull(), // base64
  signedPrekeySignature: text('signed_prekey_signature').notNull(), // base64
  signedPrekeyCreatedAt: timestamp('signed_prekey_created_at', {
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type UserE2eIdentityRow = typeof userE2eIdentities.$inferSelect;
export type NewUserE2eIdentity = typeof userE2eIdentities.$inferInsert;

export const userE2eOneTimePrekeys = chatSchema.table(
  'user_e2e_one_time_prekeys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    prekeyId: integer('prekey_id').notNull(),
    publicKey: text('public_key').notNull(), // base64
    usedAt: timestamp('used_at', { withTimezone: true }), // null = available
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('user_e2e_otp_user_prekey_uq').on(t.userId, t.prekeyId),
    // Serves the claim query in E2eKeysService.getBundle: only unused rows,
    // scoped to one user — same partial-index shape as
    // messages_conversation_unread_idx above and users_username_active_uq
    // (users.schema.ts).
    index('user_e2e_otp_available_idx')
      .on(t.userId)
      .where(sql`used_at is null`),
  ],
);

export type UserE2eOneTimePrekeyRow = typeof userE2eOneTimePrekeys.$inferSelect;
export type NewUserE2eOneTimePrekey = typeof userE2eOneTimePrekeys.$inferInsert;

/**
 * One row per (user, browser/device) key set — the multi-device successor
 * to user_e2e_identities (which stays, read-only for v1 stale clients, until
 * the Phase 3 cutover in tasks/plan-e2e-multi-device.md). A device is
 * identified by its identity key: re-registering the same key from the same
 * browser claims the existing row instead of creating a new device.
 *
 * "Active" = revokedAt is null AND lastSeenAt within 30 days, or — when a
 * user has no such device — their 2 most recently seen non-revoked devices
 * (see loadTargetDevices in chat/e2e/e2e-devices.util.ts). Senders must
 * encrypt to exactly the active set or the send is rejected with 409.
 */
export const userE2eDevices = chatSchema.table(
  'user_e2e_devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    identityKey: text('identity_key').notNull(), // base64 X25519 (DH)
    identitySigningKey: text('identity_signing_key').notNull(), // base64 Ed25519
    registrationId: integer('registration_id').notNull(),
    signedPrekeyId: integer('signed_prekey_id').notNull(),
    signedPrekeyPublic: text('signed_prekey_public').notNull(),
    signedPrekeySignature: text('signed_prekey_signature').notNull(),
    signedPrekeyCreatedAt: timestamp('signed_prekey_created_at', {
      withTimezone: true,
    }).notNull(),
    // Human-readable "Chrome · Windows" — shown on the other devices when this
    // one asks to restore chat history, so the user can recognise it.
    label: varchar('label', { length: 100 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('user_e2e_devices_user_identity_uq').on(
      t.userId,
      t.identityKey,
    ),
    index('user_e2e_devices_user_idx').on(t.userId),
  ],
);

export type UserE2eDeviceRow = typeof userE2eDevices.$inferSelect;
export type NewUserE2eDevice = typeof userE2eDevices.$inferInsert;

/**
 * Per-device one-time prekey pool. Separate from user_e2e_one_time_prekeys
 * (v1, keyed per user) because every device numbers its prekeys from its own
 * counter — a (user_id, prekey_id) unique would collide across devices.
 */
export const userE2eDevicePrekeys = chatSchema.table(
  'user_e2e_device_prekeys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => userE2eDevices.id, { onDelete: 'cascade' }),
    prekeyId: integer('prekey_id').notNull(),
    publicKey: text('public_key').notNull(), // base64
    usedAt: timestamp('used_at', { withTimezone: true }), // null = available
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('user_e2e_device_prekeys_device_prekey_uq').on(
      t.deviceId,
      t.prekeyId,
    ),
    // Serves the SKIP LOCKED claim in E2eKeysService.getDeviceBundle.
    index('user_e2e_device_prekeys_available_idx')
      .on(t.deviceId)
      .where(sql`used_at is null`),
  ],
);

export type UserE2eDevicePrekeyRow = typeof userE2eDevicePrekeys.$inferSelect;

/**
 * v2 fan-out: the message's random content key, ratchet-encrypted once per
 * recipient device (the peer's devices AND the sender's own other devices).
 * `messages.body` holds the single AEAD ciphertext all envelopes unlock.
 */
export const messageEnvelopes = chatSchema.table(
  'message_envelopes',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    recipientDeviceId: uuid('recipient_device_id')
      .notNull()
      .references(() => userE2eDevices.id, { onDelete: 'cascade' }),
    header: jsonb('header').$type<E2eHeader>().notNull(),
    wrappedKey: text('wrapped_key').notNull(), // base64
  },
  (t) => [primaryKey({ columns: [t.messageId, t.recipientDeviceId] })],
);

export type MessageEnvelopeRow = typeof messageEnvelopes.$inferSelect;

// ── Encrypted history backup (see tasks/plan-e2e-multi-device.md, Phase 4/5) ──
//
// One random backup key (BK) per account, generated in the browser and never
// seen by the server. Devices holding BK upload their decrypted history as
// AES-GCM segments under BK. A new device obtains BK either by entering the
// account's backup passcode (BK wrapped with an argon2id-derived key) or by
// an existing device approving it (BK wrapped over the device-to-device
// Double Ratchet session).

export interface BackupKdfParams {
  alg: 'argon2id';
  t: number; // iterations
  m: number; // memory, KiB
  p: number; // parallelism
}

export const e2eBackups = chatSchema.table('e2e_backups', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // base64 HMAC(BK, "npic-backup-check") — lets a device confirm the BK it
  // holds (or just unwrapped) is this account's current one. Reveals nothing
  // about BK.
  keyCheck: text('key_check').notNull(),
  // hex sha256 of keyProof = base64 HMAC(BK, "npic-backup-proof"). Unlike
  // keyCheck this is NEVER returned by any endpoint, so presenting the
  // preimage proves the caller really holds BK — keyCheck alone can't, since
  // GET /backup hands it to anyone with the account's JWT. Null only on rows
  // created before the proof existed (first setPasscode adopts one).
  keyProofHash: text('key_proof_hash'),
  // Passcode wrapping — all null until the user sets a passcode.
  passcodeSalt: text('passcode_salt'),
  passcodeParams: jsonb('passcode_params').$type<BackupKdfParams>(),
  wrappedKey: text('wrapped_key'), // base64 AES-GCM(passcode key, BK)
  // bcrypt of a passcode-derived auth key (NOT the passcode, NOT the wrap
  // key): the server releases wrappedKey only to a caller who knows the
  // passcode, which is what makes the attempt limit below enforceable.
  passcodeAuthHash: text('passcode_auth_hash'),
  failedAttempts: integer('failed_attempts').default(0).notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type E2eBackupRow = typeof e2eBackups.$inferSelect;

export const e2eBackupSegments = chatSchema.table(
  'e2e_backup_segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => userE2eDevices.id, {
      onDelete: 'set null',
    }),
    ciphertext: text('ciphertext').notNull(), // base64 AES-GCM(BK, JSON)
    messageCount: integer('message_count').notNull(),
    // precision 3: cursor-paged by (createdAt, id) through JS Dates.
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('e2e_backup_segments_user_created_idx').on(
      t.userId,
      t.createdAt,
      t.id,
    ),
  ],
);

export type E2eBackupSegmentRow = typeof e2eBackupSegments.$inferSelect;

/**
 * An end-to-end encrypted chat file (image or document). The object in the
 * private chat-files bucket is ciphertext; its key, MIME type, name, hash
 * and dimensions travel only inside the E2E message, so none of them are
 * stored here. Storage integrity is verified by the recipient (ciphertext
 * hash + GCM tag), not by the server — hence no content-hash column.
 *
 * Lifecycle: pending (upload URL issued) → uploaded (object exists, size
 * checked) → attached (referenced by a message, in the send transaction).
 * Rows never attached within 24 h are removed with their objects by cleanup.
 * See docs/e2e-attachments.md.
 */
export const chatAttachments = chatSchema.table(
  'attachments',
  {
    // Client-generated, so a retried create returns the same row.
    id: uuid('id').primaryKey(),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SET NULL on purpose: the row must outlive a deleted message so cleanup
    // still knows which storage object to remove. CASCADE would drop the row
    // and leak the object, since Postgres can't delete from the bucket.
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    // `{uploaderId}/{id}` in the chat-files bucket — server-generated.
    objectKey: text('object_key').notNull(),
    // 'image' | 'file'
    kind: varchar('kind', { length: 10 }).notNull(),
    // 'pending' | 'uploaded' | 'attached' | 'expired'
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    // Client claim at create time — informational and for the quota only.
    declaredSize: integer('declared_size').notNull(),
    // Read from storage metadata on complete; the only size that is trusted.
    actualSize: integer('actual_size'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
  },
  (t) => [
    index('attachments_message_idx').on(t.messageId),
    index('attachments_orphan_idx')
      .on(t.createdAt)
      .where(sql`message_id is null`),
    index('attachments_uploader_created_idx').on(t.uploaderId, t.createdAt),
  ],
);

export type ChatAttachmentRow = typeof chatAttachments.$inferSelect;
