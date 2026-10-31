import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { IdempotencyMiddleware } from './idempotency.middleware';

function makeDb() {
  return {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

type MockDb = ReturnType<typeof makeDb>;

function makeMiddleware(db: MockDb, verify: jest.Mock = jest.fn()) {
  const configService = { get: jest.fn().mockReturnValue(24) };
  const jwtService = { verify };
  return new IdempotencyMiddleware(
    db as never,
    configService as never,
    jwtService as never,
  );
}

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    method: 'POST',
    path: '/api/v1/listings',
    body: { a: 1 },
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const status = jest.fn();
  const json = jest.fn();
  const res = { statusCode: 200, status, json } as unknown as Response & {
    statusCode: number;
  };
  status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  json.mockReturnValue(res);
  return { res, status, json };
}

function mockDelete(db: MockDb) {
  db.delete.mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
}

function mockInsert(db: MockDb, returned: Array<{ id: string }>) {
  const values = jest.fn().mockReturnValue({
    onConflictDoNothing: () => ({
      returning: () => Promise.resolve(returned),
    }),
  });
  db.insert.mockReturnValue({ values });
  return values;
}

function mockSelect(db: MockDb, rows: unknown[]) {
  db.select.mockReturnValue({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(rows) }),
    }),
  });
}

function mockUpdate(db: MockDb, reclaimed: Array<{ id: string }> = []) {
  const set = jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      returning: () => Promise.resolve(reclaimed),
      then: (resolve: (v: undefined) => unknown) =>
        Promise.resolve(undefined).then(resolve),
      catch: () => undefined,
    }),
  });
  db.update.mockReturnValue({ set });
  return set;
}

function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

describe('IdempotencyMiddleware', () => {
  let db: MockDb;
  let next: NextFunction;

  beforeEach(() => {
    db = makeDb();
    next = jest.fn();
  });

  it('passes through without touching the DB when no Idempotency-Key header', async () => {
    const middleware = makeMiddleware(db);
    await middleware.use(makeReq(), makeRes().res, next);

    expect(next).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('rejects a blank Idempotency-Key with 400', async () => {
    const middleware = makeMiddleware(db);
    const { res, status } = makeRes();
    await middleware.use(
      makeReq({ headers: { 'idempotency-key': '   ' } }),
      res,
      next,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets the first request through when it creates the row', async () => {
    mockDelete(db);
    const values = mockInsert(db, [{ id: 'row-1' }]);
    const middleware = makeMiddleware(db);

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      makeRes().res,
      next,
    );

    expect(next).toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'key-1', userId: null }),
    );
  });

  it('scopes the row to the authenticated user from a valid bearer token', async () => {
    mockDelete(db);
    const values = mockInsert(db, [{ id: 'row-1' }]);
    const verify = jest.fn().mockReturnValue({ sub: 'user-1', role: 'user' });
    const middleware = makeMiddleware(db, verify);

    await middleware.use(
      makeReq({
        headers: { 'idempotency-key': 'key-1', authorization: 'Bearer tok' },
      }),
      makeRes().res,
      next,
    );

    expect(verify).toHaveBeenCalledWith('tok');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('treats an invalid token as anonymous', async () => {
    mockDelete(db);
    const values = mockInsert(db, [{ id: 'row-1' }]);
    const verify = jest.fn().mockImplementation(() => {
      throw new Error('invalid token');
    });
    const middleware = makeMiddleware(db, verify);

    await middleware.use(
      makeReq({
        headers: { 'idempotency-key': 'key-1', authorization: 'Bearer bad' },
      }),
      makeRes().res,
      next,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('replays the cached response for a completed row', async () => {
    mockDelete(db);
    mockInsert(db, []);
    mockSelect(db, [
      {
        id: 'row-1',
        status: 'completed',
        responseStatus: 201,
        responseBody: { success: true, data: { id: 'listing-1' } },
      },
    ]);
    const middleware = makeMiddleware(db);
    const { res, status, json } = makeRes();

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      res,
      next,
    );

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { id: 'listing-1' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 409 when the same request is already processing', async () => {
    mockDelete(db);
    mockInsert(db, []);
    mockSelect(db, [
      {
        id: 'row-1',
        status: 'processing',
        requestHash: null,
        lockedAt: new Date(),
      },
    ]);
    const middleware = makeMiddleware(db);
    const { res, status } = makeRes();

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      res,
      next,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 422 when the key is reused with a different body', async () => {
    mockDelete(db);
    mockInsert(db, []);
    mockSelect(db, [
      {
        id: 'row-1',
        status: 'processing',
        requestHash: bodyHash({ other: 'body' }),
        lockedAt: new Date(),
      },
    ]);
    const middleware = makeMiddleware(db);
    const { res, status } = makeRes();

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      res,
      next,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(next).not.toHaveBeenCalled();
  });

  it('reclaims a failed row and lets the retry through', async () => {
    mockDelete(db);
    mockInsert(db, []);
    mockSelect(db, [
      {
        id: 'row-1',
        status: 'failed',
        requestHash: null,
        lockedAt: new Date(Date.now() - 60_000),
      },
    ]);
    const set = mockUpdate(db, [{ id: 'row-1' }]);
    const middleware = makeMiddleware(db);

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      makeRes().res,
      next,
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processing' }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('caches the response as completed when the handler responds', async () => {
    mockDelete(db);
    mockInsert(db, [{ id: 'row-1' }]);
    const set = mockUpdate(db);
    const middleware = makeMiddleware(db);
    const { res } = makeRes();

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();

    res.statusCode = 201;
    res.json({ success: true, data: { id: 'listing-1' } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        responseStatus: 201,
        responseBody: { success: true, data: { id: 'listing-1' } },
      }),
    );
  });

  it('returns 422 when a completed key is replayed with a different body', async () => {
    mockDelete(db);
    mockInsert(db, []);
    mockSelect(db, [
      {
        id: 'row-1',
        status: 'completed',
        requestHash: bodyHash({ other: 'body' }),
        responseStatus: 201,
        responseBody: { success: true },
      },
    ]);
    const middleware = makeMiddleware(db);
    const { res, status } = makeRes();

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      res,
      next,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 409 when another retry already reclaimed the stale row', async () => {
    mockDelete(db);
    mockInsert(db, []);
    mockSelect(db, [
      {
        id: 'row-1',
        status: 'processing',
        requestHash: null,
        lockedAt: new Date(Date.now() - 60_000),
      },
    ]);
    mockUpdate(db, []);
    const middleware = makeMiddleware(db);
    const { res, status } = makeRes();

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      res,
      next,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  it('marks a 5xx response failed instead of caching it', async () => {
    mockDelete(db);
    mockInsert(db, [{ id: 'row-1' }]);
    const set = mockUpdate(db);
    const middleware = makeMiddleware(db);
    const { res } = makeRes();

    await middleware.use(
      makeReq({ headers: { 'idempotency-key': 'key-1' } }),
      res,
      next,
    );
    res.statusCode = 500;
    res.json({ success: false });
    await new Promise((resolve) => setImmediate(resolve));

    expect(set).toHaveBeenCalledWith({ status: 'failed' });
  });
});
