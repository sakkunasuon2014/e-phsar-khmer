import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { queueRedisOptions } from '../common/queue/queue-connection';

export type ChatPushEvent =
  | { targetUserId: string; type: 'message'; payload: unknown }
  | { targetUserId: string; type: 'inbox_update' }
  | { targetUserId: string; type: 'unread_count' }
  // The other participant read my messages in `conversationId` — the open
  // thread refetches its delta to pick up the new peerLastReadAt. Without
  // this, a WS-connected sender (whose delta poll is paused) never sees the
  // "seen" tick until focus/reconnect.
  | { targetUserId: string; type: 'read'; payload: { conversationId: string } }
  // A user-facing notification was just created (see
  // RealtimeNotificationChannel) — e.g. `payment.succeeded`, which is what
  // lets the checkout page settle without polling. Not chat-specific: this
  // socket is simply the one realtime connection a signed-in tab holds.
  | {
      targetUserId: string;
      type: 'notification';
      payload: { type: string; data?: Record<string, unknown> };
    };

const CHANNEL = 'chat:push';

/**
 * Cross-instance chat push over Redis pub/sub — reuses the same Redis
 * BullMQ already connects to (see BullModule.forRootAsync in app.module.ts).
 * ConnectionRegistry is a local, per-process Map, so ChatGateway can only
 * write to sockets on its own instance. Routing every push through Redis
 * instead of writing to local sockets directly is what lets a recipient
 * connected to a DIFFERENT backend instance still get realtime delivery — a
 * single-instance deployment still round-trips through Redis, the extra hop
 * is the price of not special-casing "am I the instance that produced this".
 *
 * `message` carries the actual row (the recipient has no other way to get
 * it before their next poll). `inbox_update` / `unread_count` carry no
 * payload on purpose — they are "something changed, refetch" signals, so the
 * client re-runs its existing query functions instead of this layer growing
 * a second serialization of inbox/unread-count shapes to keep in sync.
 */
@Injectable()
export class ChatPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatPubSubService.name);
  private readonly pub: Redis;
  private readonly sub: Redis;
  private handler: ((event: ChatPushEvent) => void) | null = null;

  constructor(private readonly config: ConfigService) {
    // Pub/sub needs its own connection — a subscribed ioredis client can't
    // issue other commands — so this is deliberately separate from BullMQ's.
    this.pub = new Redis(queueRedisOptions(this.config, 'chat-pub'));
    this.sub = new Redis(queueRedisOptions(this.config, 'chat-sub'));

    // ioredis is an EventEmitter: an 'error' event with no listener is a
    // fatal unhandled exception that crashes the whole process, not just
    // this service — required even though every call site already treats a
    // publish/subscribe failure as non-fatal.
    this.pub.on('error', (err) =>
      this.logger.warn(`Redis pub error: ${String(err)}`),
    );
    this.sub.on('error', (err) =>
      this.logger.warn(`Redis sub error: ${String(err)}`),
    );
  }

  async onModuleInit() {
    await this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_channel, raw) => {
      if (!this.handler) return;
      try {
        this.handler(JSON.parse(raw) as ChatPushEvent);
      } catch (err) {
        this.logger.warn(`Dropped malformed chat push payload: ${String(err)}`);
      }
    });
  }

  /** ChatGateway registers the one handler that delivers to local sockets. */
  onEvent(handler: (event: ChatPushEvent) => void) {
    this.handler = handler;
  }

  async publish(event: ChatPushEvent): Promise<void> {
    await this.pub.publish(CHANNEL, JSON.stringify(event));
  }

  async onModuleDestroy() {
    await Promise.all([this.sub.quit(), this.pub.quit()]);
  }
}
