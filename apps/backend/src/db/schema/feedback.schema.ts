import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * Product feedback from the public Feedback page. Anonymous submissions are
 * allowed (`userId` null); a signed-in submitter is linked so staff can see
 * the account. `imagePaths` are storage paths under `feedback/` in the default
 * bucket, uploaded server-side by FeedbackService.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 150 }).notNull(),
    phone: varchar('phone', { length: 32 }).notNull(),
    email: varchar('email', { length: 255 }),
    description: text('description').notNull(),
    imagePaths: jsonb('image_paths').$type<string[]>().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('feedback_created_at_idx').on(t.createdAt)],
);

export type FeedbackRow = typeof feedback.$inferSelect;
