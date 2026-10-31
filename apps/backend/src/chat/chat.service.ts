import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient, DbExecutor } from '../db/drizzle.provider';
import {
  conversations,
  messageEnvelopes,
  messages,
  userE2eIdentities,
} from '../db/schema/chat.schema';
import type { ConversationRow, MessageRow } from '../db/schema/chat.schema';
import {
  diffDevices,
  loadTargetDevices,
  lockE2eDeviceKeys,
} from './e2e/e2e-devices.util';
import type { ActiveDevice } from './e2e/e2e-devices.util';
import { listingPhotos, listings } from '../db/schema/listings.schema';
import { userBlocks, users } from '../db/schema/users.schema';
import { isBlockedEitherWay } from './blocks.util';
import { isUniqueViolation } from './pg-errors.util';
import { ChatPubSubService } from './chat-pubsub.service';
import type { ChatPushEvent } from './chat-pubsub.service';
import { ChatMetricsService } from './chat-metrics.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import type { PaginationMeta } from '../common/types/api-response.types';
import type { SendMessageDto } from './dto/send-message.dto';
import type { E2eV2PayloadDto } from './dto/e2e-v2.dto';
import type { QueryChatsDto } from './dto/query-chats.dto';
import type { QueryMessagesDto } from './dto/query-messages.dto';
import type {
  ChatMessagesMeta,
  ChatUserSummary,
  ConversationWithUser,
  InboxItem,
  ListingContext,
  MessageAttachmentView,
  MessageEnvelopeView,
  MessageWithEnvelopes,
  MessageWithListing,
} from './chat.types';

/** A conversation row plus the read-receipt watermark, fetched together. */
interface ConversationPollContext extends ConversationRow {
  /** max(readAt) of MY messages in this conversation. */
  peerLastReadAt: Date | null;
}

@Injectable()
export class ChatService {
  /** Cursor ids are compared against `uuid` columns; anything else is a 500. */
  private static readonly UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly pubsub: ChatPubSubService,
    private readonly metrics: ChatMetricsService,
    private readonly attachments: ChatAttachmentsService,
  ) {}

  /**
   * Fire-and-forget over Redis (see ChatPubSubService) — a dropped push just
   * means the recipient sees the change on their next poll, so a publish
   * failure must never fail the request that triggered it.
   *
   * Call sites must NOT `await` this: Redis RTT would sit on the sender's
   * response path for zero durability gain (no outbox by design). Kick it
   * off and return; errors are already swallowed here.
   */
  private publishChatEvents(events: ChatPushEvent[]): void {
    void (async () => {
      await Promise.all(
        events.map((event) =>
          this.pubsub.publish(event).catch((err: unknown) => {
            this.logger.warn(`Chat push failed: ${String(err)}`);
          }),
        ),
      );
    })();
  }

  /**
   * Above this, a send gets logged with a WARN so it shows up without
   * anyone needing to be watching — this exact threshold is what a burst of
   * concurrent sends looked like queueing for a DB pool connection (see
   * ChatMetricsService / GET /admin/chat-metrics for the running picture).
   */
  private static readonly SLOW_SEND_WARN_MS = 500;

  async sendMessage(
    senderId: string,
    dto: SendMessageDto,
  ): Promise<{ conversationId: string; message: MessageWithListing }> {
    const start = process.hrtime.bigint();
    this.metrics.beginSend();
    try {
      return await this.sendMessageInternal(senderId, dto);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      this.metrics.endSend(durationMs);
      if (durationMs > ChatService.SLOW_SEND_WARN_MS) {
        this.logger.warn(
          `Slow chat send: ${durationMs.toFixed(0)}ms (senderId=${senderId})`,
        );
      }
    }
  }

  /**
   * Active device rows for a send's two participants. Shared by the
   * fast-fail read and the authoritative re-read inside the insert
   * transaction, so both apply the exact same "active" rule — the one the
   * devices endpoint hands senders (loadTargetDevices).
   */
  private loadParticipantActiveDevices(
    executor: DbExecutor,
    userIds: [string, string],
  ): Promise<ActiveDevice[]> {
    return loadTargetDevices(executor, userIds);
  }

  /**
   * v2: envelopes must cover exactly the active device set. Checked
   * server-side because the sender's device list goes stale the instant
   * either user logs in or out anywhere else.
   *
   * Called twice: once on the fast-fail read (keeps the old error order and
   * spares the conversation upsert for an obviously stale sender), and again
   * on the locked re-read inside the insert transaction, where a device
   * registering concurrently can no longer slip in between check and insert.
   */
  private assertEnvelopesCoverActiveDevices(
    activeDevices: ActiveDevice[],
    senderId: string,
    recipientId: string,
    e2e: E2eV2PayloadDto,
  ): void {
    const senderDeviceId = e2e.senderDeviceId;
    if (
      !activeDevices.some(
        (d) => d.id === senderDeviceId && d.userId === senderId,
      )
    )
      throw new ForbiddenException({
        code: 'E2E_DEVICE_INACTIVE',
        message: 'This device is not registered for encrypted chat',
      });
    const expected = activeDevices
      .filter((d) => d.id !== senderDeviceId)
      .map((d) => ({ userId: d.userId, deviceId: d.id }));
    if (!expected.some((d) => d.userId === recipientId))
      throw new NotFoundException({
        code: 'E2E_NO_RECIPIENT_DEVICES',
        message: 'Recipient has no devices registered for encrypted chat',
      });
    const { missing, stale } = diffDevices(
      expected,
      e2e.envelopes.map((e) => e.recipientDeviceId),
    );
    if (missing.length > 0 || stale.length > 0)
      throw new ConflictException({
        code: 'E2E_DEVICES_MISMATCH',
        message: 'Device list changed',
        details: { missing, stale },
      });
  }

  private async sendMessageInternal(
    senderId: string,
    dto: SendMessageDto,
  ): Promise<{ conversationId: string; message: MessageWithListing }> {
    // Idempotent replay: a retried send (WS reconnect racing an ack, a
    // double-tap) with the same clientMessageId returns the ORIGINAL result
    // instead of re-validating and re-inserting — same intent as the REST
    // path's IdempotencyMiddleware, for the transport (WS) that has no
    // Idempotency-Key header to hang that off of. Skips all validation and
    // writes entirely on a genuine replay.
    if (dto.clientMessageId) {
      const replay = await this.findByClientMessageId(
        senderId,
        dto.clientMessageId,
      );
      if (replay) return replay;
    }

    if (dto.recipientId === senderId)
      throw new BadRequestException('Cannot message yourself');
    // New writes must be E2E-marked. Historical plaintext messages remain
    // readable, but no REST or WebSocket sender may add more plaintext rows.
    if (!dto.e2eHeader && !dto.e2e)
      throw new BadRequestException('Encrypted messages are required');
    if (!dto.body)
      throw new BadRequestException('Encrypted messages must carry a body');
    // `imagePath` is the legacy public-bucket path. Existing rows still render,
    // but new images must use private, client-encrypted v2 attachments.
    if (dto.imagePath)
      throw new BadRequestException('Unencrypted chat images are not accepted');
    if (dto.e2eHeader && dto.e2e)
      throw new BadRequestException(
        'Provide either e2eHeader or e2e, not both',
      );
    if (dto.e2e) {
      const ids = dto.e2e.envelopes.map((e) => e.recipientDeviceId);
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException('Duplicate envelope device');
      if (ids.includes(dto.e2e.senderDeviceId))
        throw new BadRequestException('No envelope for the sending device');
    }
    if (dto.attachmentIds?.length && !dto.e2e)
      throw new BadRequestException(
        'Attachments require an encrypted (v2) message',
      );
    // These three checks are independent reads (none depends on another's
    // result), so they run concurrently instead of as sequential round trips
    // to the DB — each round trip to a remote Postgres is the dominant cost
    // on this path, not query execution time. Priority of which error wins
    // when multiple checks fail stays the same as the old sequential order:
    // recipient existence, then block, then listing ownership.
    //
    // The v2 device-set read is skipped for v1 E2E messages.
    const [recipient, blocked, listing, activeDevices, recipientIdentity] =
      await Promise.all([
        this.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, dto.recipientId), isNull(users.deletedAt)))
          .limit(1)
          .then((rows) => rows[0]),
        isBlockedEitherWay(this.db, senderId, dto.recipientId),
        dto.listingId
          ? this.db
              .select({ id: listings.id, userId: listings.userId })
              .from(listings)
              .where(eq(listings.id, dto.listingId))
              .limit(1)
              .then((rows) => rows[0])
          : Promise.resolve(undefined),
        dto.e2e
          ? this.loadParticipantActiveDevices(this.db, [
              senderId,
              dto.recipientId,
            ])
          : Promise.resolve(undefined),
        dto.e2eHeader && dto.recipientIdentityKey
          ? this.db
              .select({ identityKey: userE2eIdentities.identityKey })
              .from(userE2eIdentities)
              .where(eq(userE2eIdentities.userId, dto.recipientId))
              .limit(1)
              .then((rows) => rows[0])
          : Promise.resolve(undefined),
      ]);
    if (!recipient) throw new NotFoundException('Recipient not found');
    if (blocked) throw new ForbiddenException('Messaging unavailable');
    if (dto.listingId) {
      // The context card must reference a listing owned by one of the two participants
      if (
        !listing ||
        (listing.userId !== senderId && listing.userId !== dto.recipientId)
      )
        throw new BadRequestException('Invalid listing context');
    }

    // v1: the sender's cached session was built against a recipient identity
    // that has since been replaced (they logged in on another browser). The
    // message would be undecryptable anywhere — make the client restart the
    // session against the current keys instead of storing it.
    if (
      dto.e2eHeader &&
      dto.recipientIdentityKey &&
      recipientIdentity &&
      recipientIdentity.identityKey !== dto.recipientIdentityKey
    )
      throw new ConflictException({
        code: 'E2E_SESSION_STALE',
        message: "Recipient's encryption keys changed",
      });

    // v2: fast-fail set check. The authoritative one runs again inside the
    // insert transaction, under the per-user device locks.
    if (dto.e2e && activeDevices)
      this.assertEnvelopesCoverActiveDevices(
        activeDevices,
        senderId,
        dto.recipientId,
        dto.e2e,
      );

    // Race-safe find-or-create + recency bump in one statement.
    // The bump uses the DB clock (`now()` / the column default), never
    // `new Date()`: lastMessageAt is the inbox ordering key and is compared
    // against messages.createdAt, so both must come from the same clock. An
    // app-server clock that runs ahead would park a thread at the top of every
    // participant's inbox until real time caught up.
    const [a, b] = this.canonicalPair(senderId, dto.recipientId);
    const [conversation] = await this.db
      .insert(conversations)
      .values({ userAId: a, userBId: b })
      .onConflictDoUpdate({
        target: [conversations.userAId, conversations.userBId],
        // A real message is a real interaction — revive the thread for BOTH
        // sides even if one (or both) had deleted it, not just the sender.
        set: {
          lastMessageAt: sql`now()`,
          deletedByUserAAt: null,
          deletedByUserBAt: null,
        },
      })
      .returning();

    const values = {
      conversationId: conversation.id,
      senderId,
      body: dto.body ?? null,
      clientMessageId: dto.clientMessageId ?? null,
      listingId: dto.listingId ?? null,
      imageUrl: null,
      imagePath: null,
      groupId: dto.groupId ?? null,
      isE2e: Boolean(dto.e2eHeader || dto.e2e),
      e2eHeader: dto.e2eHeader ?? null,
      e2eVersion: dto.e2e ? 2 : dto.e2eHeader ? 1 : null,
      senderDeviceId: dto.e2e?.senderDeviceId ?? null,
    };

    let message: MessageRow;
    let envelopes: MessageEnvelopeView[] | undefined;
    let attached: MessageAttachmentView[] = [];
    try {
      if (dto.e2e) {
        // Message + its envelopes (+ attachments) land together: a v2 row
        // without envelopes would be undecryptable on every device, and one
        // referencing a file that failed to attach would render broken.
        const e2e = dto.e2e;
        const attachmentIds = dto.attachmentIds ?? [];
        [message, envelopes, attached] = await this.db.transaction(
          async (tx) => {
            // A device registering after the fast-fail read above would be
            // missing from `e2e.envelopes` — it could never decrypt the
            // message. The per-user advisory locks serialize us with
            // registerDevice (same sorted keys, so no deadlock), and the
            // re-read under them is the set that actually applies.
            await lockE2eDeviceKeys(tx, [senderId, dto.recipientId]);
            const lockedDevices = await this.loadParticipantActiveDevices(tx, [
              senderId,
              dto.recipientId,
            ]);
            this.assertEnvelopesCoverActiveDevices(
              lockedDevices,
              senderId,
              dto.recipientId,
              e2e,
            );
            const [row] = await tx.insert(messages).values(values).returning();
            const rows = await tx
              .insert(messageEnvelopes)
              .values(
                e2e.envelopes.map((e) => ({
                  messageId: row.id,
                  recipientDeviceId: e.recipientDeviceId,
                  header: e.header,
                  wrappedKey: e.wrappedKey,
                })),
              )
              .returning({
                recipientDeviceId: messageEnvelopes.recipientDeviceId,
                header: messageEnvelopes.header,
                wrappedKey: messageEnvelopes.wrappedKey,
              });
            // Throws ATTACHMENT_INVALID (rolling back the message) unless every
            // id is this sender's, verified-uploaded and not yet attached.
            const files = await this.attachments.attachToMessage(
              tx,
              senderId,
              row.id,
              attachmentIds,
            );
            return [row, rows, files] as const;
          },
        );
      } else {
        [message] = await this.db.insert(messages).values(values).returning();
      }
    } catch (err) {
      // Two near-simultaneous retries with the same clientMessageId (a truly
      // concurrent double-send, not just a slow one) can both pass the replay
      // check above before either has inserted — the loser hits the unique
      // index instead of finding a row to replay. Self-heal: look up what the
      // winner just inserted and hand back that result instead of a 500.
      if (
        dto.clientMessageId &&
        isUniqueViolation(err, 'messages_sender_client_id_uq')
      ) {
        const replay = await this.findByClientMessageId(
          senderId,
          dto.clientMessageId,
        );
        if (replay) return replay;
      }
      throw err;
    }

    // Advance the thread watermark to the message's OWN createdAt. The upsert
    // above bumps lastMessageAt *before* the message row exists, so two
    // concurrent sends can commit their messages in the opposite order to
    // their bumps and leave lastMessageAt behind the newest message — which
    // would sort the thread wrongly in both participants' inboxes.
    // The `lt` predicate makes this a monotonic max: an out-of-order writer
    // can only ever move the watermark forward.
    await this.db
      .update(conversations)
      .set({ lastMessageAt: message.createdAt })
      .where(
        and(
          eq(conversations.id, conversation.id),
          lt(conversations.lastMessageAt, message.createdAt),
        ),
      );

    const contexts = await this.batchLoadListingContexts(
      dto.listingId ? [dto.listingId] : [],
    );
    const withListing: MessageWithListing = {
      ...message,
      ...(envelopes ? { envelopes } : {}),
      ...(attached.length > 0 ? { attachments: attached } : {}),
      listing: dto.listingId ? (contexts.get(dto.listingId) ?? null) : null,
    };

    // Push over the realtime channel regardless of whether this call came
    // from REST or the WS gateway — ChatGateway only ever writes to LOCAL
    // sockets, so this is the one path that reaches a recipient connected to
    // a different backend instance too. `message` carries the row; the inbox
    // / unread-count events are plain "something changed" signals — the
    // client re-runs its existing query functions rather than this layer
    // serializing those shapes a second time. Not awaited: keep Redis RTT
    // off the 201; a lost push is recovered by the recipient's next poll.
    this.publishChatEvents([
      { targetUserId: dto.recipientId, type: 'message', payload: withListing },
      { targetUserId: dto.recipientId, type: 'inbox_update' },
      { targetUserId: senderId, type: 'inbox_update' },
      { targetUserId: dto.recipientId, type: 'unread_count' },
      // v2 also fans out to the sender's OTHER devices — they hold an
      // envelope too. The sending tab ignores its own echo (dedupe by id).
      ...(dto.e2e
        ? [
            {
              targetUserId: senderId,
              type: 'message' as const,
              payload: withListing,
            },
          ]
        : []),
    ]);

    return { conversationId: conversation.id, message: withListing };
  }

  async getInbox(
    userId: string,
    query: QueryChatsDto,
  ): Promise<{ data: InboxItem[]; meta: PaginationMeta }> {
    const limit = query.limit ?? 20;
    const conditions: SQL[] = [
      // Participant AND not hidden by ME specifically — the other side's
      // delete flag is irrelevant to what I see in my own inbox.
      or(
        and(
          eq(conversations.userAId, userId),
          isNull(conversations.deletedByUserAAt),
        ),
        and(
          eq(conversations.userBId, userId),
          isNull(conversations.deletedByUserBAt),
        ),
      )!,
    ];

    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      if (decoded) {
        conditions.push(
          or(
            lt(conversations.lastMessageAt, decoded.createdAt),
            and(
              eq(conversations.lastMessageAt, decoded.createdAt),
              lt(conversations.id, decoded.id),
            ),
          )!,
        );
      }
    }

    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last ? this.encodeCursor(last.lastMessageAt, last.id) : null;

    const items = await this.buildInboxItems(userId, data);
    return { data: items, meta: { nextCursor, hasMore, limit } };
  }

  async getConversationWith(
    userId: string,
    otherUserId: string,
  ): Promise<ConversationWithUser> {
    if (otherUserId === userId)
      throw new BadRequestException('Cannot chat with yourself');

    const [otherUser] = await this.db
      .select({
        id: users.id,
        username: users.username,
        profilePhotoUrl: users.profilePhotoUrl,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(and(eq(users.id, otherUserId), isNull(users.deletedAt)))
      .limit(1);
    if (!otherUser) throw new NotFoundException('User not found');

    const blocks = await this.db
      .select()
      .from(userBlocks)
      .where(
        or(
          and(
            eq(userBlocks.blockerId, userId),
            eq(userBlocks.blockedId, otherUserId),
          ),
          and(
            eq(userBlocks.blockerId, otherUserId),
            eq(userBlocks.blockedId, userId),
          ),
        ),
      );

    const [a, b] = this.canonicalPair(userId, otherUserId);
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userAId, a), eq(conversations.userBId, b)))
      .limit(1);

    const items = conversation
      ? await this.buildInboxItems(userId, [conversation])
      : [];

    return {
      conversation: items[0] ?? null,
      otherUser,
      blockedByMe: blocks.some((row) => row.blockerId === userId),
      canMessage: blocks.length === 0,
    };
  }

  /**
   * Find-or-create the conversation with `otherUserId`, WITHOUT sending a
   * message. Backs "Message seller" → redirect-to-chat: the thread (and its
   * listing context, attached client-side until the first real send) must
   * exist and show up in both inboxes the moment the buyer opens the thread,
   * not only once they type something.
   *
   * Same rejects as sendMessage (self, missing/soft-deleted recipient,
   * block in either direction) MINUS the body/image requirement — there is
   * no content yet. Unlike the upsert in sendMessageInternal, this does NOT
   * bump lastMessageAt on an existing row (no message actually happened) and
   * only revives the conversation for the CALLER's own delete flag — the
   * other participant's inbox is unaffected by someone merely opening the
   * thread on their side.
   */
  async startConversation(
    userId: string,
    otherUserId: string,
  ): Promise<ConversationWithUser> {
    if (otherUserId === userId)
      throw new BadRequestException('Cannot chat with yourself');

    const [otherUser] = await this.db
      .select({
        id: users.id,
        username: users.username,
        profilePhotoUrl: users.profilePhotoUrl,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(and(eq(users.id, otherUserId), isNull(users.deletedAt)))
      .limit(1);
    if (!otherUser) throw new NotFoundException('User not found');

    const blocked = await isBlockedEitherWay(this.db, userId, otherUserId);
    if (blocked) throw new ForbiddenException('Messaging unavailable');

    const [a, b] = this.canonicalPair(userId, otherUserId);
    const meIsA = userId === a;
    const [conversation] = await this.db
      .insert(conversations)
      .values({ userAId: a, userBId: b })
      .onConflictDoUpdate({
        target: [conversations.userAId, conversations.userBId],
        set: meIsA ? { deletedByUserAAt: null } : { deletedByUserBAt: null },
      })
      .returning();

    const items = await this.buildInboxItems(userId, [conversation]);

    this.publishChatEvents([{ targetUserId: userId, type: 'inbox_update' }]);

    return {
      conversation: items[0] ?? null,
      otherUser,
      blockedByMe: false,
      canMessage: true,
    };
  }

  /**
   * Per-participant hide — see the `deletedByUser{A,B}At` comment on the
   * schema. Never deletes rows: the other participant's copy of the thread,
   * and every message in it, is untouched.
   */
  async deleteConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ deleted: true }> {
    const conversation = await this.getConversationForUserOrThrow(
      conversationId,
      userId,
    );
    const meIsA = conversation.userAId === userId;
    await this.db
      .update(conversations)
      .set(
        meIsA
          ? { deletedByUserAAt: sql`now()` }
          : { deletedByUserBAt: sql`now()` },
      )
      .where(eq(conversations.id, conversationId));

    this.publishChatEvents([{ targetUserId: userId, type: 'inbox_update' }]);

    return { deleted: true };
  }

  async getMessages(
    userId: string,
    conversationId: string,
    query: QueryMessagesDto,
  ): Promise<{ data: MessageWithListing[]; meta: ChatMessagesMeta }> {
    // Round trip #1 — participant auth AND the read-receipt watermark.
    const conversation = await this.getPollContextOrThrow(
      conversationId,
      userId,
    );
    if (query.cursor && query.after)
      throw new BadRequestException('Provide either cursor or after, not both');

    const limit = query.limit ?? 30;
    const afterMode = Boolean(query.after);
    const peerLastReadAt = conversation.peerLastReadAt;
    const decodedAfter = query.after ? this.decodeCursor(query.after) : null;

    // NOTE: there is deliberately no `lastMessageAt <= cursor` fast path here.
    // The watermark carries a timestamp but no id, so it cannot disambiguate
    // two messages sharing a millisecond: with m1=(T,A) and m2=(T,B), B>A, a
    // client holding cursor (T,A) sees lastMessageAt=T <= T and would be told
    // "nothing new" on that poll and on every poll after it — m2 is lost until
    // an unrelated later message moves the watermark past T. No grace window
    // fixes that (the state is stable, not settling), and tightening `<=` to
    // `<` disables the optimization outright, since on a quiet thread the
    // watermark equals the cursor timestamp by definition. Always scan.
    //
    // `conversation` is still fetched in one round trip with peerLastReadAt
    // (see getPollContextOrThrow) — that fusion is independent of the scan.

    // Scoping the scan to this conversation is what makes cursor tampering
    // inert: the cursor only ever moves a boundary WITHIN the conversation the
    // caller was just authorised for, so a forged cursor can reorder or skip
    // the caller's own messages but can never reach another thread's rows.
    const conditions: SQL[] = [eq(messages.conversationId, conversationId)];

    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      if (decoded) {
        conditions.push(
          or(
            lt(messages.createdAt, decoded.createdAt),
            and(
              eq(messages.createdAt, decoded.createdAt),
              lt(messages.id, decoded.id),
            ),
          )!,
        );
      }
    } else if (decodedAfter) {
      conditions.push(
        or(
          gt(messages.createdAt, decodedAfter.createdAt),
          and(
            eq(messages.createdAt, decodedAfter.createdAt),
            gt(messages.id, decodedAfter.id),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(
        ...(afterMode
          ? [asc(messages.createdAt), asc(messages.id)]
          : [desc(messages.createdAt), desc(messages.id)]),
      )
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    // Both modes: the last returned row is the continuation point
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null;
    // Newest returned message: first in history (DESC), last in delta (ASC).
    // An empty delta page keeps the client's watermark instead of nulling it.
    const newest = afterMode ? data[data.length - 1] : data[0];
    const latestCursor = newest
      ? this.encodeCursor(newest.createdAt, newest.id)
      : afterMode && decodedAfter
        ? query.after!
        : null;

    const listingIds = [
      ...new Set(
        data.map((m) => m.listingId).filter((id): id is string => id !== null),
      ),
    ];
    const [contexts, withEnvelopes] = await Promise.all([
      this.batchLoadListingContexts(listingIds),
      this.attachEnvelopes(data),
    ]);
    const withListing = withEnvelopes.map((m) => ({
      ...m,
      listing: m.listingId ? (contexts.get(m.listingId) ?? null) : null,
    }));

    return {
      data: withListing,
      meta: {
        nextCursor,
        hasMore,
        limit,
        latestCursor,
        peerLastReadAt,
      },
    };
  }

  async markRead(
    userId: string,
    conversationId: string,
  ): Promise<{ marked: number }> {
    const conversation = await this.getConversationForUserOrThrow(
      conversationId,
      userId,
    );
    const marked = await this.db
      .update(messages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          ne(messages.senderId, userId),
          isNull(messages.readAt),
        ),
      )
      .returning({ id: messages.id });

    // The reader's badge/inbox changed; the sender's read receipts changed.
    // The sender needs an explicit push: while their socket is connected
    // their thread's delta poll is paused, so peerLastReadAt would otherwise
    // go stale until focus/reconnect.
    if (marked.length > 0) {
      const peerId =
        conversation.userAId === userId
          ? conversation.userBId
          : conversation.userAId;
      this.publishChatEvents([
        { targetUserId: userId, type: 'unread_count' },
        { targetUserId: userId, type: 'inbox_update' },
        { targetUserId: peerId, type: 'read', payload: { conversationId } },
      ]);
    }

    return { marked: marked.length };
  }

  async getUnreadCount(userId: string): Promise<{ total: number }> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          or(
            eq(conversations.userAId, userId),
            eq(conversations.userBId, userId),
          ),
          ne(messages.senderId, userId),
          isNull(messages.readAt),
        ),
      );
    return { total: row?.total ?? 0 };
  }

  private canonicalPair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  /** Looks up a previously-sent message by its client-generated dedup key. */
  private async findByClientMessageId(
    senderId: string,
    clientMessageId: string,
  ): Promise<{ conversationId: string; message: MessageWithListing } | null> {
    const [existing] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.senderId, senderId),
          eq(messages.clientMessageId, clientMessageId),
        ),
      )
      .limit(1);
    if (!existing) return null;

    const [contexts, [withEnvelopes]] = await Promise.all([
      this.batchLoadListingContexts(
        existing.listingId ? [existing.listingId] : [],
      ),
      this.attachEnvelopes([existing]),
    ]);
    return {
      conversationId: existing.conversationId,
      message: {
        ...withEnvelopes,
        listing: existing.listingId
          ? (contexts.get(existing.listingId) ?? null)
          : null,
      },
    };
  }

  private async getConversationForUserOrThrow(
    conversationId: string,
    userId: string,
  ): Promise<ConversationRow> {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    return this.ensureParticipant(conversation, userId);
  }

  /**
   * Participant auth check + the `peerLastReadAt` read-receipt watermark in a
   * SINGLE round trip. Both are needed on every message poll — including the
   * empty deltas that skip the message range scan — so they travel together.
   */
  private async getPollContextOrThrow(
    conversationId: string,
    userId: string,
  ): Promise<ConversationPollContext> {
    const [row] = await this.db
      .select({
        id: conversations.id,
        userAId: conversations.userAId,
        userBId: conversations.userBId,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        deletedByUserAAt: conversations.deletedByUserAAt,
        deletedByUserBAt: conversations.deletedByUserBAt,
        // Aggregate over the join rather than a scalar subquery in the select
        // list: drizzle rewrites top-level columns inside a `sql` select field
        // to BARE identifiers on single-table selects, which would silently
        // resolve the correlation against `messages` instead of
        // `conversations`. The join keeps every reference qualified.
        peerLastReadAt: max(messages.readAt),
      })
      .from(conversations)
      // Scans exactly what the old standalone peerLastReadAt query scanned:
      // my messages in this conversation, via messages_conversation_created_idx.
      .leftJoin(
        messages,
        and(
          eq(messages.conversationId, conversations.id),
          eq(messages.senderId, userId),
        ),
      )
      .where(eq(conversations.id, conversationId))
      // Grouping by the PK is enough — the other conversations columns are
      // functionally dependent on it.
      .groupBy(conversations.id)
      .limit(1);

    return this.ensureParticipant(row, userId);
  }

  private ensureParticipant<T extends { userAId: string; userBId: string }>(
    conversation: T | undefined,
    userId: string,
  ): T {
    // 404 for non-participants too: no conversation-id existence oracle
    if (
      !conversation ||
      (conversation.userAId !== userId && conversation.userBId !== userId)
    )
      throw new NotFoundException('Conversation not found');
    return conversation;
  }

  private async buildInboxItems(
    userId: string,
    rows: ConversationRow[],
  ): Promise<InboxItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((c) => c.id);
    const otherIds = rows.map((c) =>
      c.userAId === userId ? c.userBId : c.userAId,
    );

    const [lastMessages, unreadCounts, userSummaries] = await Promise.all([
      this.batchLoadLastMessages(ids),
      this.batchLoadUnreadCounts(ids, userId),
      this.batchLoadUserSummaries(otherIds),
    ]);

    return rows.map((c) => {
      const otherId = c.userAId === userId ? c.userBId : c.userAId;
      return {
        id: c.id,
        otherUser: userSummaries.get(otherId) ?? null,
        lastMessage: lastMessages.get(c.id) ?? null,
        unreadCount: unreadCounts.get(c.id) ?? 0,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
      };
    });
  }

  private async batchLoadLastMessages(
    conversationIds: string[],
  ): Promise<Map<string, MessageWithEnvelopes>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([messages.conversationId])
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(
        messages.conversationId,
        desc(messages.createdAt),
        desc(messages.id),
      );
    const withEnvelopes = await this.attachEnvelopes(rows);
    return new Map(withEnvelopes.map((m) => [m.conversationId, m]));
  }

  /**
   * Adds `envelopes` (and `attachments`, when present) to v2 E2E rows — one
   * query each for the whole batch, run together. v1 and plaintext rows pass
   * through untouched, and a batch with no v2 rows issues no query at all.
   */
  private async attachEnvelopes<T extends MessageRow>(
    rows: T[],
  ): Promise<
    (T & {
      envelopes?: MessageEnvelopeView[];
      attachments?: MessageAttachmentView[];
    })[]
  > {
    const v2Ids = rows.filter((m) => m.e2eVersion === 2).map((m) => m.id);
    if (v2Ids.length === 0) return rows;

    const [envelopeRows, filesByMessage] = await Promise.all([
      this.db
        .select()
        .from(messageEnvelopes)
        .where(inArray(messageEnvelopes.messageId, v2Ids)),
      this.attachments.loadForMessages(v2Ids),
    ]);
    const byMessage = new Map<string, MessageEnvelopeView[]>();
    for (const e of envelopeRows) {
      const list = byMessage.get(e.messageId) ?? [];
      list.push({
        recipientDeviceId: e.recipientDeviceId,
        header: e.header,
        wrappedKey: e.wrappedKey,
      });
      byMessage.set(e.messageId, list);
    }
    return rows.map((m) => {
      if (m.e2eVersion !== 2) return m;
      const files = filesByMessage.get(m.id);
      return {
        ...m,
        envelopes: byMessage.get(m.id) ?? [],
        ...(files ? { attachments: files } : {}),
      };
    });
  }

  private async batchLoadUnreadCounts(
    conversationIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        conversationId: messages.conversationId,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .where(
        and(
          inArray(messages.conversationId, conversationIds),
          ne(messages.senderId, userId),
          isNull(messages.readAt),
        ),
      )
      .groupBy(messages.conversationId);
    return new Map(rows.map((r) => [r.conversationId, r.count]));
  }

  private async batchLoadUserSummaries(
    userIds: string[],
  ): Promise<Map<string, ChatUserSummary>> {
    if (userIds.length === 0) return new Map();
    // No deletedAt filter: history with soft-deleted users stays renderable;
    // new sends to them are rejected in sendMessage anyway.
    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        profilePhotoUrl: users.profilePhotoUrl,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(inArray(users.id, userIds));
    return new Map(rows.map((u) => [u.id, u]));
  }

  private async batchLoadListingContexts(
    listingIds: string[],
  ): Promise<Map<string, ListingContext>> {
    if (listingIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: listings.id,
        title: listings.title,
        price: listings.price,
        currency: listings.currency,
        status: listings.status,
      })
      .from(listings)
      .where(inArray(listings.id, listingIds));

    const photos = await this.db
      .select()
      .from(listingPhotos)
      .where(inArray(listingPhotos.listingId, listingIds))
      .orderBy(listingPhotos.sort);
    const thumbnails = new Map<string, string>();
    for (const photo of photos) {
      if (!thumbnails.has(photo.listingId))
        thumbnails.set(photo.listingId, photo.url);
    }

    return new Map(
      rows.map((l) => [
        l.id,
        { ...l, thumbnailUrl: thumbnails.get(l.id) ?? null },
      ]),
    );
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64');
  }

  private decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf8'),
      ) as { createdAt?: unknown; id?: unknown } | null;
      if (
        typeof parsed?.createdAt !== 'string' ||
        typeof parsed?.id !== 'string'
      )
        return null;
      // The id is compared against a `uuid` column. Postgres rejects a
      // non-UUID literal with 22P02, which surfaces as a 500 — so a crafted
      // cursor would be a one-request way to fault any endpoint that paginates.
      // Treat it like any other malformed cursor: ignore it.
      if (!ChatService.UUID_RE.test(parsed.id)) return null;
      const createdAt = new Date(parsed.createdAt);
      if (Number.isNaN(createdAt.getTime())) return null;
      return { createdAt, id: parsed.id };
    } catch {
      return null;
    }
  }
}
