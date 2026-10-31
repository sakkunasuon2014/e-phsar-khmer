import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validate } from './config/config.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './common/supabase/supabase.module';
import { DbModule } from './db/db.module';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { UserAwareThrottlerGuard } from './common/guards/user-aware-throttler.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { LocationsModule } from './locations/locations.module';
import { ListingsModule } from './listings/listings.module';
import { ReactionsModule } from './reactions/reactions.module';
import { UserReportsModule } from './reports/reports.module';
import { FeedbackModule } from './feedback/feedback.module';
import { AdvertisementsModule } from './advertisements/advertisements.module';
import { ResumeModule } from './resume/resume.module';
import { ApplicationsModule } from './applications/applications.module';
import { InsightsModule } from './insights/insights.module';
import { BrandsModule } from './brands/brands.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { ActivityModule } from './activity/activity.module';
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OutboxModule } from './outbox/outbox.module';
import { AttributesModule } from './attributes/attributes.module';
import { ProductsModule } from './products/products.module';
import { AdminModule } from './admin/admin.module';
import { LastSeenInterceptor } from './common/interceptors/last-seen.interceptor';
import { BullModule } from '@nestjs/bullmq';
import {
  EVENTS_STREAM_MAX_LEN,
  JOB_RETENTION,
} from './common/queue/queue-defaults';
import { createQueueClient } from './common/queue/queue-connection';
import { PaymentModule } from './payment/payment.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
      envFilePath: ['.env', '.env.local'],
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: (configService.get<number>('throttle.ttl') ?? 60) * 1000,
          limit: configService.get<number>('throttle.limit') ?? 100,
        },
      ],
    }),
    // Shared BullMQ connection. Read through ConfigService rather than
    // process.env so the Zod-validated (and coerced) values are used — a
    // raw env port is a string, and Redis options are typed for a number.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // A client INSTANCE, not an options object: BullMQ then reuses it for
        // every Queue and every Worker's non-blocking commands, and only opens
        // a dedicated connection per Worker for its blocking BZPOPMIN. With an
        // options object each Queue and Worker opened its own — 9 connections
        // per instance for 3 queues, against the free Redis Cloud cap of 30.
        // `maxRetriesPerRequest: null` is required for a connection a Worker
        // uses. BullMQ never closes a shared client; process exit does.
        connection: createQueueClient(configService),
        prefix: configService.get<string>('queue.prefix') ?? 'phsarkhmer',
        // Without these, every finished job and 10k events per queue stay
        // in Redis forever — see common/queue/queue-defaults.ts. A queue that
        // sets its own defaultJobOptions REPLACES this object (Nest merges
        // shallowly), so it must spread JOB_RETENTION itself.
        defaultJobOptions: JOB_RETENTION,
        streams: { events: { maxLen: EVENTS_STREAM_MAX_LEN } },
      }),
    }),
    SupabaseModule,
    DbModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    LocationsModule,
    ListingsModule,
    ReactionsModule,
    UserReportsModule,
    FeedbackModule,
    AdvertisementsModule,
    ResumeModule,
    ApplicationsModule,
    InsightsModule,
    BrandsModule,
    FilesModule,
    HealthModule,
    ActivityModule,
    ChatModule,
    NotificationsModule,
    OutboxModule,
    AttributesModule,
    ProductsModule,
    AdminModule,
    PaymentModule,
    SubscriptionsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // JwtAuthGuard runs FIRST so req.user is set before the throttler guard
    // reads it — UserAwareThrottlerGuard keys on user id when present,
    // falling back to IP only for anonymous/public requests.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LastSeenInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('{*splat}');
    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes(
        { path: '{*splat}', method: RequestMethod.POST },
        { path: '{*splat}', method: RequestMethod.PATCH },
        { path: '{*splat}', method: RequestMethod.PUT },
      );
  }
}
