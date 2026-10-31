import { Injectable, Logger } from '@nestjs/common';
import { ChatPubSubService } from '../../chat/chat-pubsub.service';
import type {
  NotificationChannel,
  NotificationPayload,
} from '../notification-channel.interface';

/**
 * Pushes each notification to the user's open tabs over the shared
 * WebSocket (`/ws/chat`), via the same Redis pub/sub fan-out chat uses — so
 * it reaches the user whichever backend instance holds their socket.
 *
 * Best-effort by design, and therefore catches its own errors (see
 * `NotificationsService.notify()`): the `notifications` row written by
 * `InAppNotificationChannel` is the durable record, and a missed push only
 * means the client learns about it on its next read. A failure here must
 * never make the outbox retry — that would re-insert the durable row.
 */
@Injectable()
export class RealtimeNotificationChannel implements NotificationChannel {
  private readonly logger = new Logger(RealtimeNotificationChannel.name);

  constructor(private readonly pubsub: ChatPubSubService) {}

  async send(payload: NotificationPayload): Promise<void> {
    try {
      await this.pubsub.publish({
        targetUserId: payload.userId,
        type: 'notification',
        payload: { type: payload.type, data: payload.data },
      });
    } catch (err) {
      this.logger.warn(
        `Realtime push of ${payload.type} to ${payload.userId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
