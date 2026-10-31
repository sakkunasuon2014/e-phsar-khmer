import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../db/schema';
import { seedSubscriptions } from './subscriptions.seed';

/**
 * Runs only the subscription seed (`pnpm --filter backend db:seed:subscriptions`),
 * for a shared database where re-running the whole `db:seed` would rewrite
 * categories and attributes other people are editing.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = postgres(url, { prepare: false, onnotice: () => {} });
  try {
    await seedSubscriptions(drizzle(client, { schema, casing: 'snake_case' }));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
