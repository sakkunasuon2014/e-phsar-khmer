import { validate } from './config.validation';

export default () => {
  const env = validate(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    frontendOrigins: env.FRONTEND_ORIGINS
      ? env.FRONTEND_ORIGINS.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      jwtSecret: env.SUPABASE_JWT_SECRET,
      storageBucket: env.SUPABASE_STORAGE_BUCKET,
    },
    chat: {
      filesBucket: env.CHAT_FILES_BUCKET,
      attachmentDailyBytes: env.CHAT_ATTACHMENT_DAILY_BYTES,
    },
    resume: {
      filesBucket: env.RESUME_FILES_BUCKET,
    },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    jwt: {
      secret: env.JWT_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
    },
    devOtpToken: env.DEV_OTP_TOKEN,
    idempotency: {
      ttlHours: env.IDEMPOTENCY_TTL_HOURS,
    },
    throttle: {
      ttl: env.THROTTLE_TTL,
      limit: env.THROTTLE_LIMIT,
    },
    outbox: {
      workerEnabled: env.OUTBOX_WORKER_ENABLED,
      workerConcurrency: env.OUTBOX_WORKER_CONCURRENCY,
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
      leaseTimeoutSeconds: env.OUTBOX_LEASE_TIMEOUT_SECONDS,
      backoffBaseMs: env.OUTBOX_BACKOFF_BASE_MS,
      backoffFactor: env.OUTBOX_BACKOFF_FACTOR,
      backoffMaxMs: env.OUTBOX_BACKOFF_MAX_MS,
      retentionDays: env.OUTBOX_RETENTION_DAYS,
    },
    accounts: {
      purgeEnabled: env.ACCOUNT_PURGE_ENABLED,
      purgeIntervalMs: env.ACCOUNT_PURGE_INTERVAL_MS,
    },
    queue: {
      host: env.QUEUE_HOST,
      port: env.QUEUE_PORT,
      username: env.QUEUE_USERNAME,
      password: env.QUEUE_PASSWORD,
      db: env.QUEUE_DB,
      tls: env.QUEUE_TLS,
      prefix: env.QUEUE_PREFIX,
    },
    payment: {
      jobAttempts: env.PAYMENT_JOB_ATTEMPTS,
      jobBackoffMs: env.PAYMENT_JOB_BACKOFF_MS,
      workerConcurrency: env.PAYMENT_WORKER_CONCURRENCY,
      reconcilerEnabled: env.PAYMENT_RECONCILER_ENABLED,
      reconcileIntervalMs: env.PAYMENT_RECONCILE_INTERVAL_MS,
      reconcileIdleIntervalMs: env.PAYMENT_RECONCILE_IDLE_INTERVAL_MS,
      reconcileProviders: env.PAYMENT_RECONCILE_PROVIDERS.split(',')
        .map((name) => name.trim())
        .filter(Boolean),
      pendingAbandonMs: env.PAYMENT_PENDING_ABANDON_MS,
      latePaymentGraceMs: env.PAYMENT_LATE_PAYMENT_GRACE_MS,
    },
    abaPayway: {
      apiKey: env.ABA_PAYWAY_API_KEY,
      merchantId: env.ABA_PAYWAY_MERCHANT_ID,
      baseUrl: env.ABA_PAYWAY_BASE_URL,
      webhookUrl: env.ABA_PAYWAY_WEBHOOK_URL,
      lifetimeMinutes: env.ABA_PAYWAY_LIFETIME_MINUTES,
    },
    bakong: {
      baseUrl: env.BAKONG_BASE_URL,
      apiKey: env.BAKONG_API_KEY,
      merchantType: env.BAKONG_MERCHANT_TYPE,
      merchantId: env.BAKONG_MERCHANT_ID,
      accountId: env.BAKONG_ACCOUNT_ID,
      merchantName: env.BAKONG_MERCHANT_NAME,
      merchantCity: env.BAKONG_MERCHANT_CITY,
      acquiringBank: env.BAKONG_ACQUIRING_BANK,
      qrExpirySeconds: env.BAKONG_QR_EXPIRY_SECONDS,
    },
  };
};
