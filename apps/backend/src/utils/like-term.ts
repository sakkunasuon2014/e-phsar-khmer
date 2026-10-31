/**
 * Wraps a user search string for ILIKE, escaping its own wildcards so a
 * search for "100%" or "a_b" matches literally instead of as a pattern.
 * (Backslash is Postgres's default LIKE escape character.)
 */
export const likeTerm = (q: string): string =>
  `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
