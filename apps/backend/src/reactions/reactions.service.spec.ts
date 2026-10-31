import { NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ReactionsService } from './reactions.service';

type MockDb = {
  select: jest.Mock;
  insert: jest.Mock;
  delete: jest.Mock;
};

function makeDb(): MockDb {
  return {
    select: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
  };
}

function makeService(db: MockDb) {
  return new ReactionsService(db as never);
}

/**
 * A chainable query stub that is also awaitable, so one shape serves every
 * query this service runs: direct awaits (`…innerJoin().where()`, as the
 * count and hydrate queries are) and the paged chain
 * (`…where().orderBy().limit().offset()`).
 */
function chain<T>(result: T[]) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self;
  c.innerJoin = self;
  c.leftJoin = self;
  c.where = self;
  c.orderBy = self;
  c.limit = self;
  c.offset = self;
  c.then = (resolve: (value: T[]) => unknown) =>
    Promise.resolve(result).then(resolve);
  return c;
}

/**
 * Like `chain`, but records the `where` and `orderBy` arguments so a test can
 * compile them with `PgDialect` and pin what the query actually says — the
 * pattern `listings.service.spec.ts` uses for its filter clauses.
 */
function capturingChain(
  result: unknown[],
  sink: { wheres: unknown[]; orderBys: unknown[] },
) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self;
  c.innerJoin = self;
  c.leftJoin = self;
  c.where = (arg: unknown) => {
    sink.wheres.push(arg);
    return c;
  };
  c.orderBy = (...args: unknown[]) => {
    sink.orderBys.push(...args);
    return c;
  };
  c.limit = self;
  c.offset = self;
  c.then = (resolve: (value: unknown[]) => unknown) =>
    Promise.resolve(result).then(resolve);
  return c;
}

/** The insert chain: `.values(…).onConflictDoNothing(…)` → awaitable. */
function insertChain(onConflictDoNothing: jest.Mock) {
  return {
    values: () => ({ onConflictDoNothing }),
  };
}

describe('ReactionsService', () => {
  let db: MockDb;
  let service: ReactionsService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db);
  });

  describe('likeListing', () => {
    it('throws NotFoundException when the listing does not exist', async () => {
      db.select.mockReturnValue(chain([]));

      await expect(service.likeListing('u1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('inserts with onConflictDoNothing and returns the fresh count', async () => {
      let call = 0;
      db.select.mockImplementation(() => {
        call++;
        // call 1: the existence probe; call 2: the count.
        return call === 1 ? chain([{ id: 'l1' }]) : chain([{ value: 3 }]);
      });
      const conflict = jest.fn().mockResolvedValue(undefined);
      db.insert.mockReturnValue(insertChain(conflict));

      const result = await service.likeListing('u1', 'l1');

      expect(result).toEqual({ liked: true, likeCount: 3 });
      expect(conflict).toHaveBeenCalledTimes(1);
    });
  });

  describe('unlikeListing', () => {
    it('deletes without error and returns the fresh count', async () => {
      // No existence probe on this path — only the count is read.
      db.select.mockReturnValueOnce(chain([{ value: 0 }]));
      const where = jest.fn().mockResolvedValue(undefined);
      db.delete.mockReturnValue({ where });

      const result = await service.unlikeListing('u1', 'l1');

      expect(result).toEqual({ liked: false, likeCount: 0 });
      expect(where).toHaveBeenCalledTimes(1);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the listing (and with it the edge) is gone', async () => {
      db.select.mockReturnValueOnce(chain([{ value: 0 }]));
      db.delete.mockReturnValue({ where: jest.fn().mockResolvedValue([]) });

      await expect(service.unlikeListing('u1', 'gone')).resolves.toEqual({
        liked: false,
        likeCount: 0,
      });
    });
  });

  describe('saveListing / unsaveListing', () => {
    it('saves idempotently', async () => {
      db.select.mockReturnValue(chain([{ id: 'l1' }]));
      const conflict = jest.fn().mockResolvedValue(undefined);
      db.insert.mockReturnValue(insertChain(conflict));

      await expect(service.saveListing('u1', 'l1')).resolves.toEqual({
        saved: true,
      });
      expect(conflict).toHaveBeenCalledTimes(1);
    });

    it('unsaves without error — and without an existence probe', async () => {
      db.delete.mockReturnValue({ where: jest.fn().mockResolvedValue([]) });

      await expect(service.unsaveListing('u1', 'l1')).resolves.toEqual({
        saved: false,
      });
      expect(db.select).not.toHaveBeenCalled();
    });

    it('throws NotFoundException on a missing listing', async () => {
      db.select.mockReturnValue(chain([]));

      await expect(service.saveListing('u1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getReactionIds', () => {
    it('returns both id sets in one call', async () => {
      db.select
        .mockReturnValueOnce(chain([{ listingId: 'a' }, { listingId: 'b' }]))
        .mockReturnValueOnce(chain([{ listingId: 'c' }]));

      await expect(service.getReactionIds('u1')).resolves.toEqual({
        liked: ['a', 'b'],
        saved: ['c'],
      });
    });
  });

  describe('listLikedListings', () => {
    it('paginates, hydrates photos, and reports the total', async () => {
      const listing = { id: 'l1', title: 'A bike' };
      const photo = { id: 'p1', listingId: 'l1', url: 'u', sort: 0 };
      let call = 0;
      db.select.mockImplementation(() => {
        call++;
        if (call === 1) return chain([{ listing }]);
        if (call === 2) return chain([{ value: 1 }]);
        return chain([photo]); // the photo batch
      });

      const result = await service.listLikedListings('u1', {
        page: 1,
        pageSize: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].photos).toEqual([photo]);
      expect(result.meta).toMatchObject({
        hasMore: false,
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it('reports hasMore when the page does not exhaust the total', async () => {
      const rows = Array.from({ length: 20 }, (_, i) => ({
        listing: { id: `l${i}` },
      }));
      let call = 0;
      db.select.mockImplementation(() => {
        call++;
        if (call === 1) return chain(rows);
        if (call === 2) return chain([{ value: 25 }]);
        return chain([]);
      });

      const result = await service.listLikedListings('u1', {
        page: 1,
        pageSize: 20,
      });

      expect(result.meta.hasMore).toBe(true);
      expect(result.meta.total).toBe(25);
    });
  });

  describe('listSavedListings', () => {
    it('returns saved listings with their photos', async () => {
      const listing = { id: 'l2' };
      let call = 0;
      db.select.mockImplementation(() => {
        call++;
        if (call === 1) return chain([{ listing }]);
        if (call === 2) return chain([{ value: 1 }]);
        return chain([]);
      });

      const result = await service.listSavedListings('u1', {});

      expect(result.data).toEqual([
        { id: 'l2', sellerUsername: null, photos: [] },
      ]);
      expect(result.meta.page).toBe(1);
    });
  });

  describe('countLikes', () => {
    it('returns the counted value', async () => {
      db.select.mockReturnValue(chain([{ value: 7 }]));

      await expect(service.countLikes('l1')).resolves.toBe(7);
    });
  });

  describe('list-query guarantees (compiled SQL)', () => {
    const dialect = new PgDialect();

    function wireCapture() {
      const sink = { wheres: [] as unknown[], orderBys: [] as unknown[] };
      let call = 0;
      db.select.mockImplementation(() => {
        call++;
        // Only the paged rows query is captured: the count repeats the same
        // WHERE shape, and the photo batch orders by a bare column, which
        // `sqlToQuery` (an SQL-instance API) cannot compile.
        if (call === 1)
          return capturingChain(
            [{ listing: { id: 'l1' }, sellerUsername: null }],
            sink,
          );
        if (call === 2) return chain([{ value: 1 }]);
        return chain([]);
      });
      return sink;
    }

    function compile(parts: unknown[]) {
      let sql = '';
      const params: unknown[] = [];
      for (const part of parts) {
        const q = dialect.sqlToQuery(part as never);
        sql += ` ${q.sql}`;
        params.push(...q.params);
      }
      return { sql, params };
    }

    // The list queries are now the only place the "hide deleted listings"
    // rule lives (the DELETE side no longer probes existence), so pin the
    // compiled SQL: a refactor that swaps the filter or drops the tie-break
    // must fail here rather than ship silently.
    it('listLikedListings filters deleted listings and ties on (createdAt, id)', async () => {
      const sink = wireCapture();

      await service.listLikedListings('u1', {});

      const where = compile(sink.wheres);
      expect(where.sql).toContain('"status" not in');
      expect(where.params).toEqual(
        expect.arrayContaining(['deleted', 'restricted']),
      );
      const order = compile(sink.orderBys);
      expect(order.sql).toContain('"created_at" desc');
      expect(order.sql).toContain('"id" desc');
    });

    it('listSavedListings pins the same filter and ordering', async () => {
      const sink = wireCapture();

      await service.listSavedListings('u1', {});

      const where = compile(sink.wheres);
      expect(where.sql).toContain('"status" not in');
      expect(where.params).toEqual(
        expect.arrayContaining(['deleted', 'restricted']),
      );
      const order = compile(sink.orderBys);
      expect(order.sql).toContain('"created_at" desc');
      expect(order.sql).toContain('"id" desc');
    });
  });
});
