import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Without this, SIGTERM (every Vercel scale-down and redeploy) killed the
  // process with no lifecycle hooks: BullMQ workers never closed (an active
  // payment job was left to the 30 s stalled check), ChatPubSubService never
  // QUIT its Redis connections, and OutboxWorker's own shutdown grace in
  // onModuleDestroy never ran.
  app.enableShutdownHooks();

  // Express's default JSON limit is 100 KB, which silently 413'd every E2E
  // history-backup segment above it (AddBackupSegmentDto allows ~900 KB of
  // ciphertext). 1 MB also matches the Next.js server-action body default —
  // the hop every web request crosses first — so neither limit is the
  // tighter surprise. Applies app-wide: every other DTO still caps its own
  // fields, so this only widens what can be parsed, not what is accepted.
  app.useBodyParser('json', { limit: '1mb' });

  app.setGlobalPrefix('api', { exclude: ['health', '/'] });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const rawOrigins = process.env.FRONTEND_ORIGINS ?? '';
  const frontendOrigins = rawOrigins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: frontendOrigins.length ? frontendOrigins : true,
    credentials: true,
  });

  app.useWebSocketAdapter(new WsAdapter(app));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PhsarKhmer.com API')
    .setDescription('E-Market API — PhsarKhmer.com marketplace')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0', () => {
    console.log(
      `🚀 Server listening on port ${process.env.PORT ?? 3000} (env: ${
        process.env.NODE_ENV ?? 'development'
      })`,
    );
  });
}

void bootstrap();
