import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';

function makeDb() {
  const db = {
    select: jest.fn(),
    selectDistinctOn: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  // Default no-op chain: sendMessage advances the conversation watermark after
  // inserting the message. Tests that assert on it override this.
  db.update.mockReturnValue({
    set: () => ({ where: () => Promise.resolve(undefined) }),
  });
  return db;
}

function makeService(db: ReturnType<typeof makeDb>) {
  const pubsub = { publish: jest.fn(() => Promise.resolve()) };
  const metrics = { beginSend: jest.fn(), endSend: jest.fn() };
  const attachments = {
    attachToMessage: jest.fn(
      (_tx: unknown, _sender: string, _msg: string, ids: string[]) =>
        Promise.resolve(ids.map((id) => ({ id, kind: 'image' }))),
    ),
    loadForMessages: jest.fn(() => Promise.resolve(new Map())),
  };
  const service = new ChatService(
    db as never,
    pubsub as never,
    metrics as never,
    attachments as never,
  );
  return { service, pubsub, attachments };
}

const e2eHeader = {
  v: 1 as const,
  dh: 'ratchet-pub-key',
  pn: 0,
  n: 0,
  identityKey: 'idkey',
  ephemeralKey: 'ephkey',
  oneTimePrekeyId: 3,
  signedPrekeyId: 1,
};

// .from().where().limit() → rows
function limitQuery(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  };
}

// .from().where() → rows
function whereQuery(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

// .from().leftJoin().where().groupBy().limit() → rows
// (getMessages' combined conversation-auth + peerLastReadAt lookup)
function pollQuery(rows: unknown[]) {
  return {
    from: () => ({
      leftJoin: () => ({
        where: () => ({
          groupBy: () => ({ limit: () => Promise.resolve(rows) }),
        }),
      }),
    }),
  };
}

// .from().where().orderBy() → rows
function orderByQuery(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }),
  };
}

// .from().where().orderBy().limit() → rows
function pageQuery(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
  };
}

// .from().where().groupBy() → rows
function groupByQuery(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ groupBy: () => Promise.resolve(rows) }) }),
  };
}

// .from().innerJoin().where() → rows
function joinQuery(rows: unknown[]) {
  return {
    from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }),
  };
}

/**
 * Every string literal reachable from a drizzle SQL predicate. Drizzle's SQL
 * objects hold cyclic table references, so JSON.stringify cannot be used to
 * inspect them.
 */
function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value as Record<string, unknown>).flatMap((v) =>
    collectStrings(v, seen),
  );
}

/**
 * Column names a drizzle predicate actually references. A Column also carries
 * its whole table (every column on it), so a full deep scan would report
 * `deleted_at` even when the predicate never filters on it. Walk the SQL
 * chunks and stop at Column values instead.
 */
function predicateColumns(value: unknown): string[] {
  const names: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v !== 'object' || v === null) return;
    const maybe = v as {
      name?: unknown;
      table?: unknown;
      queryChunks?: unknown;
    };
    if (typeof maybe.name === 'string' && maybe.table) {
      names.push(maybe.name);
      return;
    }
    if (Array.isArray(maybe.queryChunks)) maybe.queryChunks.forEach(visit);
  };
  visit(value);
  return names;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
    createdAt: string;
    id: string;
  };
}

const NOW = new Date('2026-07-13T10:00:00.000Z');
// Distinct from NOW so a mistaken pass-through of some other timestamp shows up.
const SEEN_AT = new Date('2026-07-13T09:30:00.000Z');

// Cursor ids are compared against `uuid` columns, so decodeCursor only accepts
// UUIDs. Tests that put an id INSIDE a cursor must use these; ids that are only
// ever asserted on (message row ids) stay readable.
const UUID = {
  m5: '55555555-5555-4555-8555-555555555555',
  mA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  mB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
} as const;

// A real UUID for the sender, so imagePath ownership tests exercise the same
// shape production does (`chat/{uuid}/{uuid}-{name}`).
const conversation = {
  id: 'c1',
  userAId: 'u1',
  userBId: 'u2',
  lastMessageAt: NOW,
  createdAt: NOW,
};

function makeMessage(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    conversationId: 'c1',
    senderId: 'u2',
    body: 'hi',
    listingId: null,
    imageUrl: null,
    imagePath: null,
    readAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe('ChatService.sendMessage', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  function mockInserts(captured: Record<string, unknown>[]) {
    db.insert.mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        captured.push(v);
        return {
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([conversation]),
          }),
          returning: () =>
            Promise.resolve([
              makeMessage('m1', { senderId: 'u1', ...captured[1] }),
            ]),
        };
      },
    }));
  }

  it('throws BadRequestException when messaging yourself', async () => {
    await expect(
      service.sendMessage('u1', { recipientId: 'u1', body: 'hi' }),
    ).rejects.toThrow(BadRequestException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when neither body nor imagePath present', async () => {
    await expect(
      service.sendMessage('u1', { recipientId: 'u2' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when imagePath is outside own chat folder', async () => {
    await expect(
      service.sendMessage('u1', {
        recipientId: 'u2',
        imagePath: 'chat/u9/pic.jpg',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when imagePath contains a traversal', async () => {
    await expect(
      service.sendMessage('u1', {
        recipientId: 'u2',
        imagePath: 'chat/u1/../u9/pic.jpg',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when recipient is missing or soft-deleted', async () => {
    db.select.mockReturnValue(limitQuery([]));

    await expect(
      service.sendMessage('u1', { recipientId: 'u2', body: 'hi', e2eHeader }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when a block exists in either direction', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u2' }]); // recipient
      return limitQuery([{ id: 'block-1' }]); // block row
    });

    await expect(
      service.sendMessage('u1', { recipientId: 'u2', body: 'hi', e2eHeader }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException when listing belongs to neither participant', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u2' }]); // recipient
      if (callCount === 2) return limitQuery([]); // no block
      return limitQuery([{ id: 'l1', userId: 'u9' }]); // foreign listing
    });

    await expect(
      service.sendMessage('u1', {
        recipientId: 'u2',
        body: 'ciphertext',
        e2eHeader,
        listingId: 'l1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates the conversation and message on happy text send', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u2' }]);
      return limitQuery([]); // no block
    });
    const captured: Record<string, unknown>[] = [];
    mockInserts(captured);

    const result = await service.sendMessage('u1', {
      recipientId: 'u2',
      body: 'ciphertext',
      e2eHeader,
    });

    expect(result.conversationId).toBe('c1');
    expect(result.message.listing).toBeNull();
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(captured[0]).toMatchObject({ userAId: 'u1', userBId: 'u2' });
    expect(captured[1]).toMatchObject({
      conversationId: 'c1',
      senderId: 'u1',
      body: 'ciphertext',
      imageUrl: null,
    });
  });

  it('advances the conversation watermark to the message createdAt', async () => {
    // lastMessageAt is the inbox ordering key, so it must not lag the newest
    // message: the pre-insert upsert bump happens before the message row
    // exists, and under concurrent sends the two can commit out of order.
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u2' }]);
      return limitQuery([]);
    });
    mockInserts([]);
    const sets: Record<string, unknown>[] = [];
    db.update.mockImplementation(() => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        return { where: () => Promise.resolve(undefined) };
      },
    }));

    await service.sendMessage('u1', {
      recipientId: 'u2',
      body: 'hi',
      e2eHeader,
    });

    expect(sets).toEqual([{ lastMessageAt: NOW }]);
  });

  it('canonicalizes the pair order regardless of sender', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u1' }]);
      return limitQuery([]);
    });
    const captured: Record<string, unknown>[] = [];
    mockInserts(captured);

    await service.sendMessage('u2', {
      recipientId: 'u1',
      body: 'yo',
      e2eHeader,
    });

    expect(captured[0]).toMatchObject({ userAId: 'u1', userBId: 'u2' });
  });

  it('rejects the legacy public-image send path', async () => {
    await expect(
      service.sendMessage('u1', {
        recipientId: 'u2',
        imagePath: 'chat/u1/pic.jpg',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('attaches the listing context card on listing send', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u2' }]); // recipient
      if (callCount === 2) return limitQuery([]); // no block
      if (callCount === 3) return limitQuery([{ id: 'l1', userId: 'u2' }]); // listing owned by recipient
      if (callCount === 4)
        return whereQuery([
          {
            id: 'l1',
            title: 'iPhone 13 Pro',
            price: '520.00',
            currency: 'USD',
            status: 'active',
          },
        ]);
      return orderByQuery([{ listingId: 'l1', url: 'https://cdn/p1.jpg' }]);
    });
    const captured: Record<string, unknown>[] = [];
    mockInserts(captured);

    const result = await service.sendMessage('u1', {
      recipientId: 'u2',
      body: 'ciphertext',
      e2eHeader,
      listingId: 'l1',
    });

    expect(result.message.listing).toEqual({
      id: 'l1',
      title: 'iPhone 13 Pro',
      price: '520.00',
      currency: 'USD',
      status: 'active',
      thumbnailUrl: 'https://cdn/p1.jpg',
    });
  });

  it('throws BadRequestException when e2eHeader is combined with imagePath', async () => {
    await expect(
      service.sendMessage('u1', {
        recipientId: 'u2',
        imagePath: 'chat/u1/pic.jpg',
        e2eHeader,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('stores isE2e: true and the e2eHeader when present', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u2' }]);
      return limitQuery([]);
    });
    const captured: Record<string, unknown>[] = [];
    mockInserts(captured);

    await service.sendMessage('u1', {
      recipientId: 'u2',
      body: 'ciphertext-blob',
      e2eHeader,
    });

    expect(captured[1]).toMatchObject({
      body: 'ciphertext-blob',
      isE2e: true,
      e2eHeader,
    });
  });

  it('rejects a plaintext body instead of persisting it', async () => {
    await expect(
      service.sendMessage('u1', { recipientId: 'u2', body: 'hi' }),
    ).rejects.toThrow(BadRequestException);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ── v1 stale-identity check (Phase 0) ─────────────────────────────────────

  function selectsWithIdentity(identityKey: string) {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u2' }]); // recipient
      if (callCount === 2) return limitQuery([]); // no block
      return limitQuery([{ identityKey }]); // recipient's current identity
    });
  }

  it('rejects a v1 send encrypted to a replaced identity with 409 E2E_SESSION_STALE', async () => {
    selectsWithIdentity('new-key');

    const err = await service
      .sendMessage('u1', {
        recipientId: 'u2',
        body: 'ciphertext',
        e2eHeader,
        recipientIdentityKey: 'old-key',
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'E2E_SESSION_STALE',
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('accepts a v1 send whose identity key still matches', async () => {
    selectsWithIdentity('same-key');
    const captured: Record<string, unknown>[] = [];
    mockInserts(captured);

    await service.sendMessage('u1', {
      recipientId: 'u2',
      body: 'ciphertext',
      e2eHeader,
      recipientIdentityKey: 'same-key',
    });

    expect(captured[1]).toMatchObject({ isE2e: true, e2eVersion: 1 });
  });
});

describe('ChatService.sendMessage — v2 multi-device', () => {
  let db: ReturnType<typeof makeDb> & { transaction: jest.Mock };
  let service: ChatService;
  let pubsub: { publish: jest.Mock };

  const header = { v: 1 as const, dh: 'dh', pn: 0, n: 0 };
  const env = (recipientDeviceId: string) => ({
    recipientDeviceId,
    header,
    wrappedKey: 'wrapped',
  });

  beforeEach(() => {
    db = Object.assign(makeDb(), { transaction: jest.fn() });
    ({ service, pubsub } = makeService(db));
  });

  /** A non-revoked device row as loadTargetDevices reads it. */
  const device = (id: string, userId: string, fresh = true, seenDay = 25) => ({
    id,
    userId,
    lastSeenAt: new Date(Date.UTC(2026, 9, seenDay)),
    fresh,
  });

  /** Active devices: u1 = [d-me, d-me2], u2 = [d-peer]. */
  const activeDevices = [
    device('d-me', 'u1'),
    device('d-me2', 'u1'),
    device('d-peer', 'u2'),
  ];

  function selectsWithDevices(devices = activeDevices) {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return limitQuery([{ id: 'u2' }]); // recipient
      if (callCount === 2) return limitQuery([]); // no block
      return whereQuery(devices); // active devices of both users
    });
  }

  /**
   * The v2 insert transaction. A send takes the per-user device advisory locks
   * and re-reads the active set inside it, so the tx mock needs `execute` for
   * the locks and a `select` reporting what the locked re-read sees.
   */
  function mockSendTx(devices = activeDevices) {
    const tx = {
      execute: jest.fn(() => Promise.resolve([])),
      select: jest.fn(() => whereQuery(devices)),
      insert: jest.fn(),
    };
    db.transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
      cb(tx),
    );
    return tx;
  }

  function send(envelopes: ReturnType<typeof env>[], senderDeviceId = 'd-me') {
    return service.sendMessage('u1', {
      recipientId: 'u2',
      body: 'aead-ciphertext',
      e2e: { v: 2, senderDeviceId, envelopes },
    });
  }

  it('rejects combining e2e with e2eHeader', async () => {
    await expect(
      service.sendMessage('u1', {
        recipientId: 'u2',
        body: 'x',
        e2eHeader: header,
        e2e: { v: 2, senderDeviceId: 'd-me', envelopes: [env('d-peer')] },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an envelope addressed to the sending device itself', async () => {
    await expect(send([env('d-peer'), env('d-me')])).rejects.toThrow(
      BadRequestException,
    );
  });

  it("returns 409 E2E_DEVICES_MISMATCH listing the peer's new device and a stale one", async () => {
    selectsWithDevices();

    const err = await send([env('d-me2'), env('d-gone')]).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'E2E_DEVICES_MISMATCH',
      details: {
        missing: [{ userId: 'u2', deviceId: 'd-peer' }],
        stale: ['d-gone'],
      },
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("requires the sender's own other devices too (self-sync)", async () => {
    selectsWithDevices();

    const err = await send([env('d-peer')]).catch((e: unknown) => e);

    expect((err as ConflictException).getResponse()).toMatchObject({
      details: { missing: [{ userId: 'u1', deviceId: 'd-me2' }], stale: [] },
    });
  });

  it('rejects a sending device that is not active with 403', async () => {
    selectsWithDevices([device('d-peer', 'u2')]);

    await expect(send([env('d-peer')])).rejects.toThrow(ForbiddenException);
  });

  it('returns 404 E2E_NO_RECIPIENT_DEVICES when the peer has no active device', async () => {
    selectsWithDevices([device('d-me', 'u1')]);

    await expect(send([env('d-peer')])).rejects.toThrow(NotFoundException);
  });

  describe('recipient whose every device is stale', () => {
    // u2 went quiet past DEVICE_STALE_DAYS on three browsers. The fallback
    // keeps their two most recently seen devices targetable instead of
    // answering E2E_NO_RECIPIENT_DEVICES.
    const quietPeer = [
      device('d-me', 'u1'),
      device('p-old', 'u2', false, 1),
      device('p-new', 'u2', false, 9),
      device('p-mid', 'u2', false, 5),
    ];

    function mockConversationUpsert() {
      db.insert.mockImplementation(() => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([conversation]),
          }),
        }),
      }));
    }

    it('accepts envelopes for exactly the newest two devices', async () => {
      selectsWithDevices(quietPeer);
      mockConversationUpsert();
      const tx = mockSendTx(quietPeer);
      let txInsert = 0;
      tx.insert.mockImplementation(() => ({
        values: (v: unknown) => ({
          returning: () =>
            Promise.resolve(
              ++txInsert === 1
                ? [makeMessage('m1', { senderId: 'u1', e2eVersion: 2 })]
                : (v as Record<string, unknown>[]),
            ),
        }),
      }));

      const result = await send([env('p-new'), env('p-mid')]);

      expect(result.message.envelopes).toHaveLength(2);
    });

    it('rejects an envelope for a stale device outside the fallback', async () => {
      selectsWithDevices(quietPeer);

      const err = await send([env('p-new'), env('p-mid'), env('p-old')]).catch(
        (e: unknown) => e,
      );

      expect((err as ConflictException).getResponse()).toMatchObject({
        code: 'E2E_DEVICES_MISMATCH',
        details: { missing: [], stale: ['p-old'] },
      });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('rejects a send missing one of the fallback devices', async () => {
      selectsWithDevices(quietPeer);

      const err = await send([env('p-new')]).catch((e: unknown) => e);

      expect((err as ConflictException).getResponse()).toMatchObject({
        code: 'E2E_DEVICES_MISMATCH',
        details: { missing: [{ userId: 'u2', deviceId: 'p-mid' }], stale: [] },
      });
    });
  });

  it('stores message + envelopes in one transaction and pushes to both users', async () => {
    selectsWithDevices();
    const captured: Record<string, unknown>[] = [];
    // Conversation upsert goes through db.insert; message + envelopes through tx.
    db.insert.mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        captured.push(v);
        return {
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([conversation]),
          }),
        };
      },
    }));
    const txInserts: unknown[] = [];
    const tx = mockSendTx();
    tx.insert.mockImplementation(() => ({
      values: (v: unknown) => {
        txInserts.push(v);
        return {
          returning: () =>
            Promise.resolve(
              txInserts.length === 1
                ? [makeMessage('m1', { senderId: 'u1', e2eVersion: 2 })]
                : (v as Record<string, unknown>[]).map((e) => ({
                    recipientDeviceId: e.recipientDeviceId,
                    header: e.header,
                    wrappedKey: e.wrappedKey,
                  })),
            ),
        };
      },
    }));

    const result = await send([env('d-peer'), env('d-me2')]);

    expect(txInserts[0]).toMatchObject({
      isE2e: true,
      e2eVersion: 2,
      e2eHeader: null,
      senderDeviceId: 'd-me',
    });
    expect(txInserts[1]).toEqual([
      { messageId: 'm1', ...env('d-peer') },
      { messageId: 'm1', ...env('d-me2') },
    ]);
    expect(result.message.envelopes).toHaveLength(2);

    await new Promise((r) => setImmediate(r));
    const targets = pubsub.publish.mock.calls
      .map(([e]) => e as { targetUserId: string; type: string })
      .filter((e) => e.type === 'message')
      .map((e) => e.targetUserId);
    expect(targets.sort()).toEqual(['u1', 'u2']);
  });

  it('rejects 409 and writes nothing when a device registers between the outer check and the insert', async () => {
    // The fast-fail read passes: the envelopes cover the outer active set.
    selectsWithDevices();
    // The locked re-read inside the transaction sees the device registered
    // after that read. Inserting now would hand every recipient a message the
    // new device has no envelope for — reject instead.
    const tx = mockSendTx([...activeDevices, device('d-new', 'u2')]);
    db.insert.mockImplementation(() => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([conversation]),
        }),
      }),
    }));

    const err = await send([env('d-peer'), env('d-me2')]).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'E2E_DEVICES_MISMATCH',
      details: { missing: [{ userId: 'u2', deviceId: 'd-new' }], stale: [] },
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
    // The only insert is the conversation upsert; no message row is written.
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

describe('ChatService.sendMessage — attachments', () => {
  let db: ReturnType<typeof makeDb> & { transaction: jest.Mock };
  let service: ChatService;
  let attachments: ReturnType<typeof makeService>['attachments'];
  const header = { v: 1 as const, dh: 'dh', pn: 0, n: 0 };
  const e2e = {
    v: 2 as const,
    senderDeviceId: 'd-me',
    envelopes: [{ recipientDeviceId: 'd-peer', header, wrappedKey: 'w' }],
  };

  beforeEach(() => {
    db = Object.assign(makeDb(), { transaction: jest.fn() });
    ({ service, attachments } = makeService(db));
    let calls = 0;
    db.select.mockImplementation(() => {
      calls++;
      if (calls === 1) return limitQuery([{ id: 'u2' }]);
      if (calls === 2) return limitQuery([]);
      return whereQuery([
        { id: 'd-me', userId: 'u1' },
        { id: 'd-peer', userId: 'u2' },
      ]);
    });
    db.insert.mockImplementation(() => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([conversation]),
        }),
      }),
    }));
  });

  function mockTx() {
    let n = 0;
    const tx = {
      execute: jest.fn(() => Promise.resolve([])),
      select: jest.fn(() =>
        whereQuery([
          { id: 'd-me', userId: 'u1' },
          { id: 'd-peer', userId: 'u2' },
        ]),
      ),
      insert: jest.fn(() => ({
        values: () => ({
          returning: () =>
            Promise.resolve(
              ++n === 1
                ? [makeMessage('m1', { senderId: 'u1', e2eVersion: 2 })]
                : [{ recipientDeviceId: 'd-peer', header, wrappedKey: 'w' }],
            ),
        }),
      })),
    };
    db.transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
      cb(tx),
    );
    return tx;
  }

  it('rejects attachments on a message that is not v2 E2E', async () => {
    await expect(
      service.sendMessage('u1', {
        recipientId: 'u2',
        body: 'hi',
        attachmentIds: ['a1'],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(attachments.attachToMessage).not.toHaveBeenCalled();
  });

  it('attaches inside the send transaction and returns the attachments', async () => {
    const tx = mockTx();

    const result = await service.sendMessage('u1', {
      recipientId: 'u2',
      body: 'aead',
      e2e,
      attachmentIds: ['a1', 'a2'],
    });

    expect(attachments.attachToMessage).toHaveBeenCalledWith(tx, 'u1', 'm1', [
      'a1',
      'a2',
    ]);
    expect(result.message.attachments).toEqual([
      { id: 'a1', kind: 'image' },
      { id: 'a2', kind: 'image' },
    ]);
  });

  it('fails the send when an attachment cannot be attached (tx rolls back)', async () => {
    mockTx();
    attachments.attachToMessage.mockRejectedValueOnce(
      new BadRequestException({ code: 'ATTACHMENT_INVALID' }),
    );

    await expect(
      service.sendMessage('u1', {
        recipientId: 'u2',
        body: 'aead',
        e2e,
        attachmentIds: ['foreign'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('omits `attachments` on a v2 send without files', async () => {
    mockTx();

    const result = await service.sendMessage('u1', {
      recipientId: 'u2',
      body: 'aead',
      e2e,
    });

    expect(result.message).not.toHaveProperty('attachments');
  });
});

describe('ChatService.getMessages', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  it('throws NotFoundException for an unknown conversation', async () => {
    db.select.mockReturnValue(pollQuery([]));

    await expect(service.getMessages('u1', 'c-unknown', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException for a non-participant', async () => {
    db.select.mockReturnValue(
      pollQuery([{ ...conversation, userAId: 'x1', userBId: 'x2' }]),
    );

    await expect(service.getMessages('u1', 'c1', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException when cursor and after are both set', async () => {
    db.select.mockReturnValue(pollQuery([conversation]));

    await expect(
      service.getMessages('u1', 'c1', { cursor: 'a', after: 'b' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('pages history DESC with nextCursor and latestCursor', async () => {
    const m3 = makeMessage('m3', {
      createdAt: new Date('2026-07-13T10:03:00.000Z'),
    });
    const m2 = makeMessage('m2', {
      createdAt: new Date('2026-07-13T10:02:00.000Z'),
    });
    const m1 = makeMessage('m1', {
      createdAt: new Date('2026-07-13T10:01:00.000Z'),
    });
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      // #1 carries peerLastReadAt (null here) alongside the conversation row
      if (callCount === 1)
        return pollQuery([{ ...conversation, peerLastReadAt: null }]);
      return pageQuery([m3, m2, m1]); // limit+1 rows
    });

    const result = await service.getMessages('u1', 'c1', { limit: 2 });

    expect(result.data.map((m) => m.id)).toEqual(['m3', 'm2']);
    expect(result.meta.hasMore).toBe(true);
    expect(decodeCursor(result.meta.nextCursor!).id).toBe('m2');
    expect(decodeCursor(result.meta.latestCursor!).id).toBe('m3');
    expect(result.meta.peerLastReadAt).toBeNull();
  });

  it('returns deltas ASC in after mode with peerLastReadAt watermark', async () => {
    const readDate = new Date('2026-07-13T10:05:00.000Z');
    const m4 = makeMessage('m4', {
      createdAt: new Date('2026-07-13T10:04:00.000Z'),
    });
    const m5 = makeMessage('m5', {
      createdAt: new Date('2026-07-13T10:05:00.000Z'),
    });
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      // The conversation watermark tracks the newest message (m5), so it is
      // past the client's cursor and the range scan must run.
      if (callCount === 1)
        return pollQuery([
          {
            ...conversation,
            lastMessageAt: m5.createdAt,
            peerLastReadAt: readDate,
          },
        ]);
      return pageQuery([m4, m5]);
    });

    const after = encodeCursor(new Date('2026-07-13T10:03:00.000Z'), 'm3');
    const result = await service.getMessages('u1', 'c1', { after });

    expect(result.data.map((m) => m.id)).toEqual(['m4', 'm5']);
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.nextCursor).toBeNull();
    expect(decodeCursor(result.meta.latestCursor!).id).toBe('m5');
    expect(result.meta.peerLastReadAt).toBe(readDate);
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});

describe('ChatService.getMessages delta polling', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  const watermark = new Date('2026-07-13T10:05:00.000Z');
  const atWatermark = encodeCursor(watermark, UUID.m5);

  // Conversation whose newest message is m5 — i.e. the client is caught up.
  function quietConversation(peerLastReadAt: Date | null) {
    return { ...conversation, lastMessageAt: watermark, peerLastReadAt };
  }

  // Auth/peerLastReadAt lookup, then the message range scan.
  function mockPoll(conv: Record<string, unknown>, rows: unknown[]) {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return pollQuery([conv]);
      return pageQuery(rows);
    });
  }

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  // REGRESSION: a `lastMessageAt <= cursor.createdAt` fast path used to answer
  // this poll with an empty page, permanently. The watermark carries no id, so
  // when two messages share a millisecond it cannot tell "client has both" from
  // "client has the lower-id one" — and the second message was never delivered
  // until unrelated later traffic moved the watermark. Always scan.
  it('delivers a same-millisecond message the watermark cannot distinguish', async () => {
    const mB = makeMessage('mB', { id: UUID.mB, createdAt: watermark });
    // Client holds (T, mA); mB committed at the same T with a higher id, so
    // lastMessageAt === the client's cursor timestamp.
    mockPoll(quietConversation(null), [mB]);

    const result = await service.getMessages('u1', 'c1', {
      after: encodeCursor(watermark, UUID.mA),
    });

    expect(result.data.map((m) => m.id)).toEqual([UUID.mB]);
    expect(decodeCursor(result.meta.latestCursor!).id).toBe(UUID.mB);
    // The range scan ran rather than being skipped on the watermark.
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('scans on a caught-up delta poll instead of trusting the watermark', async () => {
    mockPoll(quietConversation(null), []);

    const result = await service.getMessages('u1', 'c1', {
      after: atWatermark,
    });

    expect(result.data).toEqual([]);
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.nextCursor).toBeNull();
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('keeps returning a fresh peerLastReadAt on empty polls', async () => {
    // The peer marks my messages read. That moves messages.read_at but NOT
    // conversations.last_message_at, so an empty delta must still surface it —
    // otherwise read receipts freeze until someone sends a new message.
    const readDate = new Date('2026-07-13T10:07:30.000Z');
    mockPoll(quietConversation(readDate), []);

    const result = await service.getMessages('u1', 'c1', {
      after: atWatermark,
    });

    expect(result.data).toEqual([]);
    expect(result.meta.peerLastReadAt).toBe(readDate);

    // ...and a later receipt is picked up on the next equally-empty poll
    const laterReadDate = new Date('2026-07-13T10:09:00.000Z');
    mockPoll(quietConversation(laterReadDate), []);

    const next = await service.getMessages('u1', 'c1', { after: atWatermark });
    expect(next.data).toEqual([]);
    expect(next.meta.peerLastReadAt).toBe(laterReadDate);
  });

  it('echoes the client cursor as latestCursor on an empty poll', async () => {
    mockPoll(quietConversation(null), []);

    const result = await service.getMessages('u1', 'c1', {
      after: atWatermark,
    });

    // Not null: a client that stores meta.latestCursor must not lose its
    // watermark and re-fetch the whole thread on the next poll.
    expect(result.meta.latestCursor).toBe(atWatermark);
  });

  it('returns new messages when the watermark is newer than the cursor', async () => {
    const m6 = makeMessage('m6', {
      createdAt: new Date('2026-07-13T10:06:00.000Z'),
    });
    mockPoll(
      { ...conversation, lastMessageAt: m6.createdAt, peerLastReadAt: null },
      [m6],
    );

    const result = await service.getMessages('u1', 'c1', {
      after: atWatermark,
    });

    expect(result.data.map((m) => m.id)).toEqual(['m6']);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('ignores an unparseable after cursor', async () => {
    mockPoll(quietConversation(null), []);

    const result = await service.getMessages('u1', 'c1', {
      after: '!!not-a-cursor!!',
    });

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(result.meta.latestCursor).toBeNull();
  });
});

describe('ChatService.markRead', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  it('throws NotFoundException for an unknown conversation', async () => {
    db.select.mockReturnValue(limitQuery([]));

    await expect(service.markRead('u1', 'c1')).rejects.toThrow(
      NotFoundException,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('marks all unread messages from the other user', async () => {
    db.select.mockReturnValue(limitQuery([conversation]));
    db.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: 'm1' }, { id: 'm2' }]),
        }),
      }),
    });

    const result = await service.markRead('u1', 'c1');
    expect(result).toEqual({ marked: 2 });
  });

  it('pushes a read receipt to the other participant', async () => {
    const { service: svc, pubsub } = makeService(db);
    db.select.mockReturnValue(limitQuery([conversation]));
    db.update.mockReturnValue({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([{ id: 'm1' }]) }),
      }),
    });

    // u2 reads → u1 (the sender) is told
    await svc.markRead('u2', 'c1');
    await new Promise((r) => setImmediate(r));

    expect(pubsub.publish).toHaveBeenCalledWith({
      targetUserId: 'u1',
      type: 'read',
      payload: { conversationId: 'c1' },
    });
  });

  it('pushes nothing when there was nothing to mark', async () => {
    const { service: svc, pubsub } = makeService(db);
    db.select.mockReturnValue(limitQuery([conversation]));
    db.update.mockReturnValue({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    });

    await svc.markRead('u1', 'c1');
    await new Promise((r) => setImmediate(r));

    expect(pubsub.publish).not.toHaveBeenCalled();
  });
});

describe('ChatService.getInbox', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  it('short-circuits batch loads on an empty page', async () => {
    db.select.mockReturnValue(pageQuery([]));

    const result = await service.getInbox('u1', {});

    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({
      nextCursor: null,
      hasMore: false,
      limit: 20,
    });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.selectDistinctOn).not.toHaveBeenCalled();
  });

  it('ignores an invalid cursor', async () => {
    db.select.mockReturnValue(pageQuery([]));

    await expect(
      service.getInbox('u1', { cursor: '!!not-a-cursor!!' }),
    ).resolves.toBeDefined();
  });

  it('assembles otherUser, lastMessage and unreadCount per conversation', async () => {
    const lastMessage = makeMessage('m9');
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return pageQuery([conversation]);
      if (callCount === 2)
        return groupByQuery([{ conversationId: 'c1', count: 3 }]);
      return whereQuery([
        {
          id: 'u2',
          username: 'dara',
          profilePhotoUrl: null,
          lastSeenAt: SEEN_AT,
        },
      ]);
    });
    db.selectDistinctOn.mockReturnValue(orderByQuery([lastMessage]));

    const result = await service.getInbox('u1', {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 'c1',
      otherUser: {
        id: 'u2',
        username: 'dara',
        profilePhotoUrl: null,
        lastSeenAt: SEEN_AT,
      },
      unreadCount: 3,
    });
    expect(result.data[0].lastMessage).toEqual(lastMessage);
    expect(result.meta.hasMore).toBe(false);
  });

  it('preserves a null lastSeenAt for a peer who has never been active', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return pageQuery([conversation]);
      if (callCount === 2) return groupByQuery([]);
      return whereQuery([
        {
          id: 'u2',
          username: 'dara',
          profilePhotoUrl: null,
          lastSeenAt: null,
        },
      ]);
    });
    db.selectDistinctOn.mockReturnValue(orderByQuery([]));

    const result = await service.getInbox('u1', {});

    // Never-active is a real state, not "missing": keep the null instead of
    // substituting a timestamp the server never observed.
    expect(result.data[0].otherUser).toEqual({
      id: 'u2',
      username: 'dara',
      profilePhotoUrl: null,
      lastSeenAt: null,
    });
  });

  it('still returns a soft-deleted peer’s lastSeenAt (no deletedAt filter)', async () => {
    let callCount = 0;
    const summaryWheres: unknown[] = [];
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return pageQuery([conversation]);
      if (callCount === 2) return groupByQuery([]);
      return {
        from: () => ({
          where: (predicate: unknown) => {
            summaryWheres.push(predicate);
            return Promise.resolve([
              {
                id: 'u2',
                username: 'dara',
                profilePhotoUrl: null,
                lastSeenAt: SEEN_AT,
              },
            ]);
          },
        }),
      };
    });
    db.selectDistinctOn.mockReturnValue(orderByQuery([]));

    const result = await service.getInbox('u1', {});

    // The only column the summary lookup reads is id: no deleted_at IS NULL
    // clause, because history with a soft-deleted peer must stay renderable
    // (new sends to them are rejected in sendMessage instead).
    expect(predicateColumns(summaryWheres[0])).toEqual(['id']);
    expect(result.data[0].otherUser?.lastSeenAt).toEqual(SEEN_AT);
  });
});

describe('ChatService.getUnreadCount', () => {
  it('returns the total across all conversations', async () => {
    const db = makeDb();
    const { service } = makeService(db);
    db.select.mockReturnValue(joinQuery([{ total: 5 }]));

    await expect(service.getUnreadCount('u1')).resolves.toEqual({ total: 5 });
  });
});

describe('ChatService.getConversationWith', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  it('throws BadRequestException for yourself', async () => {
    await expect(service.getConversationWith('u1', 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when the user is missing or soft-deleted', async () => {
    db.select.mockReturnValue(limitQuery([]));

    await expect(service.getConversationWith('u1', 'u2')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns a null conversation when none exists yet', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return limitQuery([
          {
            id: 'u2',
            username: 'dara',
            profilePhotoUrl: null,
            lastSeenAt: SEEN_AT,
          },
        ]);
      if (callCount === 2) return whereQuery([]); // no blocks
      return limitQuery([]); // no conversation
    });

    const result = await service.getConversationWith('u1', 'u2');

    expect(result).toEqual({
      conversation: null,
      otherUser: {
        id: 'u2',
        username: 'dara',
        profilePhotoUrl: null,
        lastSeenAt: SEEN_AT,
      },
      blockedByMe: false,
      canMessage: true,
    });
  });

  it('reports blockedByMe and canMessage flags', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return limitQuery([
          {
            id: 'u2',
            username: 'dara',
            profilePhotoUrl: null,
            lastSeenAt: SEEN_AT,
          },
        ]);
      if (callCount === 2)
        return whereQuery([{ blockerId: 'u1', blockedId: 'u2' }]);
      return limitQuery([]);
    });

    const result = await service.getConversationWith('u1', 'u2');

    expect(result.blockedByMe).toBe(true);
    expect(result.canMessage).toBe(false);
  });

  it('never creates a conversation (read-only contract)', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return limitQuery([
          {
            id: 'u2',
            username: 'dara',
            profilePhotoUrl: null,
            lastSeenAt: SEEN_AT,
          },
        ]);
      if (callCount === 2) return whereQuery([]);
      return limitQuery([]);
    });

    await service.getConversationWith('u1', 'u2');

    // A resolve endpoint that upserted would let anyone plant a thread in a
    // stranger's inbox — and would bypass the block check sendMessage does.
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('exposes only the narrow ChatUserSummary allow-list', async () => {
    let callCount = 0;
    let projection: Record<string, unknown> | undefined;
    db.select.mockImplementation((fields?: Record<string, unknown>) => {
      callCount++;
      if (callCount === 1) {
        projection = fields;
        return limitQuery([
          {
            id: 'u2',
            username: 'dara',
            profilePhotoUrl: null,
            lastSeenAt: SEEN_AT,
          },
        ]);
      }
      if (callCount === 2) return whereQuery([]);
      return limitQuery([]);
    });

    const result = await service.getConversationWith('u1', 'u2');

    // The SELECT itself is the allow-list: asserting the projection (not just
    // the mocked row's keys) is what proves phone/email/role/deletedAt cannot
    // ride along. lastSeenAt is deliberately allowed: coarse last activity,
    // only ever shown to a participant, never derived into online status.
    expect(Object.keys(projection ?? {}).sort()).toEqual([
      'id',
      'lastSeenAt',
      'profilePhotoUrl',
      'username',
    ]);
    expect(Object.keys(result.otherUser).sort()).toEqual([
      'id',
      'lastSeenAt',
      'profilePhotoUrl',
      'username',
    ]);
  });
});

describe('ChatService conversation authorisation (security)', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  const foreign = { ...conversation, userAId: 'x1', userBId: 'x2' };

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  // 404, never 403. A 403 would confirm the conversation exists and turn the
  // id space into an enumeration oracle for "who is talking to whom".
  it('getMessages gives a non-participant 404, not 403', async () => {
    db.select.mockReturnValue(pollQuery([foreign]));

    const err: unknown = await service
      .getMessages('u1', 'c1', {})
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(err).not.toBeInstanceOf(ForbiddenException);
  });

  it('markRead gives a non-participant 404, not 403', async () => {
    db.select.mockReturnValue(limitQuery([foreign]));

    const err: unknown = await service
      .markRead('u1', 'c1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(err).not.toBeInstanceOf(ForbiddenException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('is indistinguishable between a foreign and a missing conversation', async () => {
    db.select.mockReturnValue(pollQuery([foreign]));
    const foreignErr = (await service
      .getMessages('u1', 'c1', {})
      .catch((e: unknown) => e)) as NotFoundException;

    db.select.mockReturnValue(pollQuery([]));
    const missingErr = (await service
      .getMessages('u1', 'c-nope', {})
      .catch((e: unknown) => e)) as NotFoundException;

    // Same status and same body — nothing distinguishes "exists but not yours"
    // from "does not exist".
    expect(foreignErr.getStatus()).toBe(missingErr.getStatus());
    expect(foreignErr.getResponse()).toEqual(missingErr.getResponse());
  });

  it('authorises before reading any message row', async () => {
    db.select.mockReturnValue(pollQuery([foreign]));

    await expect(service.getMessages('u1', 'c1', {})).rejects.toThrow(
      NotFoundException,
    );
    // Exactly one query: the auth lookup. No message scan was issued.
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});

describe('ChatService cursor tampering (security)', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  // A cursor id lands in a comparison against a `uuid` column. Postgres answers
  // a non-UUID literal with 22P02, which surfaces as a 500 — a one-request
  // fault injection. Malformed ids must be ignored like any other bad cursor.
  const malformed = [
    'not-a-uuid',
    "' OR 1=1--",
    '00000000-0000-0000-0000-00000000000',
    '',
  ];

  it.each(malformed)('ignores a non-UUID cursor id (%s)', async (id) => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return pollQuery([{ ...conversation, peerLastReadAt: null }]);
      return pageQuery([]);
    });

    const result = await service.getMessages('u1', 'c1', {
      after: encodeCursor(NOW, id),
    });

    // Treated as absent, not passed through to the query layer.
    expect(result.meta.latestCursor).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('ignores a non-UUID cursor id on the inbox', async () => {
    db.select.mockReturnValue(pageQuery([]));

    await expect(
      service.getInbox('u1', { cursor: encodeCursor(NOW, 'not-a-uuid') }),
    ).resolves.toMatchObject({ data: [] });
  });

  it('cannot reach another conversation with a forged cursor', async () => {
    // The cursor only ever moves a boundary; the conversation scope comes from
    // the participant-checked path param, so a forged cursor stays inside the
    // caller's own thread.
    const wheres: unknown[] = [];
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return pollQuery([{ ...conversation, peerLastReadAt: null }]);
      return {
        from: () => ({
          where: (w: unknown) => {
            wheres.push(w);
            return { orderBy: () => ({ limit: () => Promise.resolve([]) }) };
          },
        }),
      };
    });

    await service.getMessages('u1', 'c1', {
      after: encodeCursor(NOW, UUID.mA),
    });

    // One scan, and its predicate was built from the authorised id.
    expect(wheres).toHaveLength(1);
    expect(collectStrings(wheres[0])).toContain('c1');
  });
});

describe('ChatService.startConversation', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
    db.selectDistinctOn.mockReturnValue(orderByQuery([]));
  });

  it('throws BadRequestException for yourself', async () => {
    await expect(service.startConversation('u1', 'u1')).rejects.toThrow(
      BadRequestException,
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the user is missing or soft-deleted', async () => {
    db.select.mockReturnValue(limitQuery([]));

    await expect(service.startConversation('u1', 'u2')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ForbiddenException when a block exists in either direction', async () => {
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return limitQuery([
          {
            id: 'u2',
            username: 'dara',
            profilePhotoUrl: null,
            lastSeenAt: SEEN_AT,
          },
        ]);
      return limitQuery([{ id: 'b1' }]); // isBlockedEitherWay
    });

    await expect(service.startConversation('u1', 'u2')).rejects.toThrow(
      ForbiddenException,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('finds-or-creates without requiring a message, and clears only the caller’s delete flag', async () => {
    let selectCount = 0;
    db.select.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1)
        return limitQuery([
          {
            id: 'u2',
            username: 'dara',
            profilePhotoUrl: null,
            lastSeenAt: SEEN_AT,
          },
        ]);
      if (selectCount === 2) return limitQuery([]); // not blocked
      if (selectCount === 3) return groupByQuery([]); // unread counts
      return whereQuery([
        {
          id: 'u2',
          username: 'dara',
          profilePhotoUrl: null,
          lastSeenAt: SEEN_AT,
        },
      ]); // user summaries
    });

    let capturedSet: unknown;
    db.insert.mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        expect(v).toMatchObject({ userAId: 'u1', userBId: 'u2' });
        return {
          onConflictDoUpdate: (opts: { set: unknown }) => {
            capturedSet = opts.set;
            return { returning: () => Promise.resolve([conversation]) };
          },
        };
      },
    }));

    const result = await service.startConversation('u1', 'u2');

    // u1 < u2 canonically, so u1 IS userA — only its delete flag is revived.
    expect(capturedSet).toEqual({ deletedByUserAAt: null });
    expect(result.otherUser).toEqual({
      id: 'u2',
      username: 'dara',
      profilePhotoUrl: null,
      lastSeenAt: SEEN_AT,
    });
    expect(result.canMessage).toBe(true);
    expect(result.blockedByMe).toBe(false);
    expect(result.conversation).not.toBeNull();
  });

  it('never requires body/image content (unlike sendMessage)', async () => {
    let selectCount = 0;
    db.select.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1)
        return limitQuery([
          {
            id: 'u3',
            username: 'sopha',
            profilePhotoUrl: null,
            lastSeenAt: SEEN_AT,
          },
        ]);
      if (selectCount === 2) return limitQuery([]);
      if (selectCount === 3) return groupByQuery([]);
      return whereQuery([]);
    });
    db.insert.mockImplementation(() => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([conversation]),
        }),
      }),
    }));

    await expect(service.startConversation('u2', 'u3')).resolves.toBeDefined();
  });
});

describe('ChatService.deleteConversation', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ChatService;

  beforeEach(() => {
    db = makeDb();
    ({ service } = makeService(db));
  });

  it('throws NotFoundException for a non-participant (no existence oracle)', async () => {
    db.select.mockReturnValue(limitQuery([conversation]));

    await expect(service.deleteConversation('u9', 'c1')).rejects.toThrow(
      NotFoundException,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('sets deletedByUserAAt when the caller is userA', async () => {
    db.select.mockReturnValue(limitQuery([conversation])); // userAId: 'u1'
    const sets: Record<string, unknown>[] = [];
    db.update.mockImplementation(() => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        return { where: () => Promise.resolve(undefined) };
      },
    }));

    const result = await service.deleteConversation('u1', 'c1');

    expect(result).toEqual({ deleted: true });
    expect(sets).toHaveLength(1);
    expect(Object.keys(sets[0])).toEqual(['deletedByUserAAt']);
  });

  it('sets deletedByUserBAt when the caller is userB', async () => {
    db.select.mockReturnValue(limitQuery([conversation])); // userBId: 'u2'
    const sets: Record<string, unknown>[] = [];
    db.update.mockImplementation(() => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        return { where: () => Promise.resolve(undefined) };
      },
    }));

    await service.deleteConversation('u2', 'c1');

    expect(Object.keys(sets[0])).toEqual(['deletedByUserBAt']);
  });

  it('leaves the other participant unaffected (per-user hide only)', async () => {
    // deleteConversation touches only ONE column; the row (and the other
    // side's copy of the thread) is never removed.
    db.select.mockReturnValue(limitQuery([conversation]));
    const sets: Record<string, unknown>[] = [];
    db.update.mockImplementation(() => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        return { where: () => Promise.resolve(undefined) };
      },
    }));
    db.delete.mockImplementation(() => {
      throw new Error('deleteConversation must never hard-delete a row');
    });

    await service.deleteConversation('u1', 'c1');

    expect(db.delete).not.toHaveBeenCalled();
    expect(sets[0]).not.toHaveProperty('deletedByUserBAt');
  });
});
