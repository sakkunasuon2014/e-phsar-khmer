import { Module } from '@nestjs/common';
import { ChatPubSubService } from './chat-pubsub.service';

/**
 * The Redis pub/sub push transport on its own — no chat feature graph.
 *
 * `ChatModule` owns sockets and the message path, but the transport is
 * shared: `NotificationsModule`'s realtime channel publishes over the same
 * `/ws/chat` push channel. Importing all of `ChatModule` for that closed a
 * module cycle — `ChatModule → AuthModule → NotificationsModule → ChatModule`
 * — whose CJS evaluation left `ChatModule.imports[0]` undefined at boot.
 * Keeping the transport in this leaf module lets both importers share one
 * `ChatPubSubService` instance (and its Redis connections) without the cycle.
 */
@Module({
  providers: [ChatPubSubService],
  exports: [ChatPubSubService],
})
export class ChatPubSubModule {}
