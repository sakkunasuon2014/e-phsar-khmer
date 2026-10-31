import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ChatPubSubModule } from '../chat/chat-pubsub.module';
import { InAppNotificationChannel } from './channels/in-app-notification.channel';
import { RealtimeNotificationChannel } from './channels/realtime-notification.channel';
import { NOTIFICATION_CHANNELS } from './notification-channel.interface';

/**
 * User-facing notifications: a durable in-app feed today, an extension
 * point for other channels (email, push) later — see
 * `notification-channel.interface.ts`'s own doc comment. Not `@Global()`,
 * same rationale as `ChatModule`/`OutboxModule`: an importer is making a
 * real choice (it now sends notifications).
 */
@Module({
  // The pubsub leaf provides the socket push transport for the realtime
  // channel without importing the chat feature (which imports AuthModule).
  imports: [ChatPubSubModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    InAppNotificationChannel,
    RealtimeNotificationChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      // Add a future channel (e.g. EmailNotificationChannel) to this array —
      // nothing else in the module needs to change. In-app stays first: it
      // is the durable record, the realtime push is best-effort.
      inject: [InAppNotificationChannel, RealtimeNotificationChannel],
      useFactory: (
        inApp: InAppNotificationChannel,
        realtime: RealtimeNotificationChannel,
      ) => [inApp, realtime],
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
