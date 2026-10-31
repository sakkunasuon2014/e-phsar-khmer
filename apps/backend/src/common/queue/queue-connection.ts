import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Redis, { type RedisOptions } from 'ioredis';

/**
 * The one place the QUEUE_* config becomes ioredis options — shared by the
 * BullMQ root connection (app.module.ts) and ChatPubSubService, which used to
 * build the same object twice.
 *
 * `role` lands in `CLIENT SETNAME`, so `CLIENT LIST` on the Redis side shows
 * which component of which instance holds each connection (the free Redis
 * Cloud plan caps connections at 30, and an unnamed list is unreadable).
 */
export function queueRedisOptions(
  configService: ConfigService,
  role: string,
): RedisOptions {
  const prefix = configService.get<string>('queue.prefix') ?? 'phsar';
  return {
    host: configService.get<string>('queue.host') ?? 'localhost',
    port: configService.get<number>('queue.port') ?? 6379,
    username: configService.get<string>('queue.username'),
    password: configService.get<string>('queue.password'),
    db: configService.get<number>('queue.db') ?? 0,
    tls: configService.get<boolean>('queue.tls') ? {} : undefined,
    connectionName: `${prefix}:${role}`,
  };
}

/**
 * The single client every BullMQ Queue and Worker in this process shares (see
 * BullModule.forRootAsync). Workers still open one extra blocking connection
 * each, duplicated from this client.
 */
export function createQueueClient(configService: ConfigService): Redis {
  const client = new Redis({
    ...queueRedisOptions(configService, 'bullmq'),
    maxRetriesPerRequest: null,
  });
  // An 'error' event with no listener crashes the process. BullMQ attaches
  // its own once the first Queue is built; this covers the gap before that.
  client.on('error', (err) =>
    new Logger('QueueConnection').warn(`Redis error: ${String(err)}`),
  );
  return client;
}
