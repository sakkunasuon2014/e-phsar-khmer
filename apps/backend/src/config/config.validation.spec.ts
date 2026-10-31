import { validate } from './config.validation';

const requiredEnvironment = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  DATABASE_URL: 'postgres://user:password@localhost:5432/app',
  JWT_SECRET: '0123456789abcdef',
  JWT_REFRESH_SECRET: 'fedcba9876543210',
};

describe('outbox worker configuration', () => {
  it.each([
    ['OUTBOX_WORKER_CONCURRENCY', '0'],
    ['OUTBOX_WORKER_CONCURRENCY', '1.5'],
    ['OUTBOX_POLL_INTERVAL_MS', '0'],
    ['OUTBOX_BATCH_SIZE', '0'],
  ])('rejects invalid %s=%s values', (key, value) => {
    expect(() => validate({ ...requiredEnvironment, [key]: value })).toThrow(
      key,
    );
  });
});
