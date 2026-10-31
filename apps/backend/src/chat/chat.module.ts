import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatPubSubModule } from './chat-pubsub.module';
import { ChatMetricsService } from './chat-metrics.service';
import { ConnectionRegistry } from './connection-registry';
import { HeartbeatService } from './heartbeat.service';
import { E2eKeysController } from './e2e/e2e-keys.controller';
import { E2eKeysService } from './e2e/e2e-keys.service';
import { E2eDevicesController } from './e2e/e2e-devices.controller';
import { E2eBackupController } from './e2e/e2e-backup.controller';
import { E2eBackupService } from './e2e/e2e-backup.service';
import { E2eNudgeController } from './e2e/e2e-nudge.controller';
import { E2eNudgeService } from './e2e/e2e-nudge.service';
import { ChatAttachmentsController } from './chat-attachments.controller';
import { ChatAttachmentsService } from './chat-attachments.service';
import {
  CHAT_MAINTENANCE_QUEUE,
  ChatMaintenanceProcessor,
  ChatMaintenanceScheduler,
} from './chat-maintenance.processor';

@Module({
  imports: [
    AuthModule,
    ChatPubSubModule,
    // E2eNudgeService needs NotificationsService to post the nudge. No
    // forwardRef: NotificationsModule imports the ChatPubSubModule leaf (not
    // ChatModule), so the old ChatModule ↔ NotificationsModule cycle is gone.
    NotificationsModule,
    // Attachment cleanup only — see chat-maintenance.processor.ts.
    BullModule.registerQueue({ name: CHAT_MAINTENANCE_QUEUE }),
  ],
  controllers: [
    ChatController,
    E2eKeysController,
    E2eDevicesController,
    E2eBackupController,
    E2eNudgeController,
    ChatAttachmentsController,
  ],
  providers: [
    ChatService,
    ChatMetricsService,
    ConnectionRegistry,
    HeartbeatService,
    ChatGateway,
    E2eKeysService,
    E2eBackupService,
    E2eNudgeService,
    ChatAttachmentsService,
    ChatMaintenanceScheduler,
    ChatMaintenanceProcessor,
  ],
  // The pubsub transport is shared with NotificationsModule's realtime
  // channel — see chat-pubsub.module.ts for why it is not provided here.
  exports: [ChatService, ChatMetricsService, ChatPubSubModule],
})
export class ChatModule {}
