import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ApplicationsService } from './applications.service';

const APPLICANT = '11111111-1111-4111-8111-111111111111';
const POSTER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const LISTING = '44444444-4444-4444-8444-444444444444';
const APPLICATION = '55555555-5555-4555-8555-555555555555';
const ATTACHMENT = '66666666-6666-4666-8666-666666666666';
const CONVERSATION = '77777777-7777-4777-8777-777777777777';
const MESSAGE = '88888888-8888-4888-8888-888888888888';

/**
 * An encrypted application payload, as the browser sends it: a ciphertext
 * body plus the E2E envelope. The service never inspects either.
 */
const E2E = { v: 2 } as never;
const ENCRYPTED = { body: 'CIPHERTEXT', e2e: E2E };

type MockDb = {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
};

function makeDb(): MockDb {
  return { select: jest.fn(), insert: jest.fn(), update: jest.fn() };
}

function makeService(db: MockDb, overrides: Partial<ServiceMocks> = {}) {
  const mocks: ServiceMocks = {
    chat: {
      sendMessage: jest.fn().mockResolvedValue({
        conversationId: CONVERSATION,
        message: { id: MESSAGE },
      }),
    } as never,
    notifications: { notify: jest.fn().mockResolvedValue(undefined) } as never,
    resume: {
      getDocument: jest.fn().mockResolvedValue({ exists: false }),
    } as never,
    resumeAttachments: {
      signAttachmentById: jest.fn().mockResolvedValue(null),
    } as never,
    ...overrides,
  };
  const service = new ApplicationsService(
    db as never,
    mocks.chat,
    mocks.notifications,
    mocks.resume,
    mocks.resumeAttachments,
  );
  return { service, mocks };
}

interface ServiceMocks {
  chat: { sendMessage: jest.Mock };
  notifications: { notify: jest.Mock };
  resume: { getDocument: jest.Mock };
  resumeAttachments: { signAttachmentById: jest.Mock };
}

/** Chainable and awaitable — the shape every read in this service uses. */
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

/** Records the `where` arguments so a test can compile and read them. */
function capturingChain(result: unknown[], sink: { wheres: unknown[] }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self;
  c.innerJoin = self;
  c.leftJoin = self;
  c.where = (arg: unknown) => {
    sink.wheres.push(arg);
    return c;
  };
  c.orderBy = self;
  c.limit = self;
  c.offset = self;
  c.then = (resolve: (value: unknown[]) => unknown) =>
    Promise.resolve(result).then(resolve);
  return c;
}

function insertChain(returning: unknown[]) {
  return {
    values: () => ({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve(returning),
      }),
    }),
  };
}

function updateChain(returning: unknown[]) {
  return {
    set: () => ({
      where: () => ({ returning: () => Promise.resolve(returning) }),
    }),
  };
}

/** The listing row `loadJob` selects, before its photo query. */
function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING,
    title: 'HEAD BAKER',
    price: '600.00',
    currency: 'USD',
    status: 'active',
    company: 'AUSBAKE',
    posterId: POSTER,
    categorySlug: 'jobs',
    posterDeletedAt: null,
    ...overrides,
  };
}

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION,
    listingId: LISTING,
    applicantId: APPLICANT,
    posterId: POSTER,
    coverNote: null,
    resumeSnapshot: null,
    status: 'pending',
    viewedAt: null,
    decidedAt: null,
    createdAt: new Date('2026-10-16T00:00:00Z'),
    updatedAt: new Date('2026-10-16T00:00:00Z'),
    ...overrides,
  };
}

function resumeDocument(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    personal: null,
    summary: 'Baker with ten years',
    hobbies: '',
    experiences: [],
    educations: [],
    skills: [],
    languages: [],
    references: [],
    jobPreference: null,
    attachment: {
      id: ATTACHMENT,
      fileName: 'cv.pdf',
      size: 1024,
      uploadedAt: '2026-10-01T00:00:00Z',
    },
    ...overrides,
  };
}

/** Queue one `select` result per call, in the order the service makes them. */
function queueSelects(db: MockDb, ...results: unknown[][]) {
  for (const result of results) db.select.mockReturnValueOnce(chain(result));
}

describe('ApplicationsService', () => {
  let db: MockDb;

  beforeEach(() => {
    db = makeDb();
  });

  describe('apply — rejections', () => {
    it('404s when the listing does not exist', async () => {
      queueSelects(db, []);
      const { service, mocks } = makeService(db);

      await expect(service.apply(APPLICANT, LISTING, {})).rejects.toThrow(
        NotFoundException,
      );
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('400s when the listing is not a job', async () => {
      queueSelects(db, [jobRow({ categorySlug: 'cars' })]);

      const { service, mocks } = makeService(db);
      await expect(service.apply(APPLICANT, LISTING, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('400s when applying to your own job', async () => {
      queueSelects(db, [jobRow({ posterId: APPLICANT })]);

      const { service, mocks } = makeService(db);
      await expect(service.apply(APPLICANT, LISTING, {})).rejects.toThrow(
        'Cannot apply to your own job',
      );
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    });

    it('400s when the job is no longer active', async () => {
      queueSelects(db, [jobRow({ status: 'expired' })]);

      const { service, mocks } = makeService(db);
      await expect(service.apply(APPLICANT, LISTING, {})).rejects.toThrow(
        'no longer accepting applications',
      );
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('404s when the poster is soft-deleted', async () => {
      queueSelects(db, [jobRow({ posterDeletedAt: new Date() })]);

      const { service, mocks } = makeService(db);
      await expect(service.apply(APPLICANT, LISTING, {})).rejects.toThrow(
        'Job poster not found',
      );
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    });

    it('409s with the existing id when the pair already applied', async () => {
      queueSelects(
        db,
        [jobRow()],
        [applicationRow()], // findByPair already has one
      );

      const { service, mocks } = makeService(db);
      await expect(service.apply(APPLICANT, LISTING, {})).rejects.toMatchObject(
        {
          response: {
            code: 'JOB_APPLICATION_EXISTS',
            details: { applicationId: APPLICATION },
          },
        },
      );
      // A duplicate must never re-send or re-notify.
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
      expect(mocks.notifications.notify).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('apply — happy path', () => {
    /**
     * Every read `apply` makes on its success path, in order: the job, the
     * pair probe, then (only when no chat message is sent) the block check,
     * then the two name lookups behind the notification and the response.
     */
    function arrangeHappyPath(
      opts: { resumeDocument?: unknown; encrypted?: boolean } = {},
    ) {
      queueSelects(
        db,
        [jobRow()], // loadJob
        [], // findByPair — nothing yet
        ...(opts.encrypted === false ? [[]] : []), // isBlockedEitherWay
      );
      db.insert.mockReturnValue(insertChain([applicationRow()]));
      // notifyPoster's name lookup …
      db.select.mockReturnValueOnce(
        chain([{ username: 'sokdara', firstName: 'Sok', lastName: 'Dara' }]),
      );
      // … then the response's two concurrent reads: poster summary, photos.
      db.select.mockReturnValueOnce(
        chain([{ id: POSTER, username: 'ausbake', profilePhotoUrl: null }]),
      );
      db.select.mockReturnValueOnce(chain([]));
      const { service, mocks } = makeService(db, {
        resume: {
          getDocument: jest
            .fn()
            .mockResolvedValue(opts.resumeDocument ?? { exists: false }),
        } as never,
      });
      return { service, mocks };
    }

    /** Re-points the insert at a spy so a test can read the stored values. */
    function captureInsertValues(returning = [applicationRow()]) {
      const values = jest.fn().mockReturnValue({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(returning),
        }),
      });
      db.insert.mockReturnValue({ values });
      return values;
    }

    it('sends the chat message before inserting the row', async () => {
      const order: string[] = [];
      const { service, mocks } = arrangeHappyPath();
      mocks.chat.sendMessage.mockImplementation(() => {
        order.push('chat');
        return Promise.resolve({});
      });
      db.insert.mockImplementation(() => {
        order.push('insert');
        return insertChain([applicationRow()]);
      });

      await service.apply(APPLICANT, LISTING, {
        coverNote: 'Hello',
        ...ENCRYPTED,
      });

      expect(order).toEqual(['chat', 'insert']);
    });

    it('delivers the encrypted payload through chat with a deterministic dedup key', async () => {
      const { service, mocks } = arrangeHappyPath();

      await service.apply(APPLICANT, LISTING, {
        coverNote: '  Hello  ',
        ...ENCRYPTED,
      });

      expect(mocks.chat.sendMessage).toHaveBeenCalledWith(APPLICANT, {
        recipientId: POSTER,
        listingId: LISTING,
        body: 'CIPHERTEXT',
        e2e: E2E,
        clientMessageId: `apply:${LISTING}:${APPLICANT}`,
      });
    });

    it('returns the chat delivery ids so the browser can commit its ratchet session', async () => {
      const { service } = arrangeHappyPath();

      const result = await service.apply(APPLICANT, LISTING, ENCRYPTED);

      expect(result.chat).toEqual({
        conversationId: CONVERSATION,
        message: { id: MESSAGE },
      });
    });

    it('records the application without a chat message when no E2E payload is supplied', async () => {
      const { service, mocks } = arrangeHappyPath({ encrypted: false });

      const result = await service.apply(APPLICANT, LISTING, {
        coverNote: 'Hello',
      });

      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
      expect(mocks.notifications.notify).toHaveBeenCalledTimes(1);
      expect(result.chat).toBeNull();
    });

    it('403s a blocked pair even when no chat message is sent', async () => {
      queueSelects(
        db,
        [jobRow()],
        [], // findByPair
        [{ id: 'block-row' }], // isBlockedEitherWay
      );
      const { service, mocks } = makeService(db);

      await expect(
        service.apply(APPLICANT, LISTING, { coverNote: 'Hello' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('400s a body with no E2E payload (plaintext is never stored)', async () => {
      queueSelects(db, [jobRow()], []);
      const { service, mocks } = makeService(db);

      await expect(
        service.apply(APPLICANT, LISTING, { body: 'plaintext' }),
      ).rejects.toThrow('Application messages must be encrypted');
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('400s an E2E payload with no body', async () => {
      queueSelects(db, [jobRow()], []);
      const { service, mocks } = makeService(db);

      await expect(
        service.apply(APPLICANT, LISTING, { e2e: E2E }),
      ).rejects.toThrow('must carry a body');
      expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    });

    it('notifies the poster exactly once, gated on the inserted row', async () => {
      const { service, mocks } = arrangeHappyPath({ encrypted: false });

      await service.apply(APPLICANT, LISTING, { coverNote: 'Hello' });

      expect(mocks.notifications.notify).toHaveBeenCalledTimes(1);
      expect(mocks.notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: POSTER,
          type: 'application.created',
          title: 'Sok Dara applied for HEAD BAKER',
          data: {
            applicationId: APPLICATION,
            listingId: LISTING,
            applicantId: APPLICANT,
          },
        }),
      );
    });

    it('stores the résumé snapshot when the applicant has a résumé', async () => {
      const document = resumeDocument();
      const { service } = arrangeHappyPath({
        resumeDocument: document,
        encrypted: false,
      });
      const values = captureInsertValues();

      await service.apply(APPLICANT, LISTING, {});

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          listingId: LISTING,
          applicantId: APPLICANT,
          posterId: POSTER,
          resumeSnapshot: document,
        }),
      );
    });

    it('stores a null snapshot when the applicant has no résumé', async () => {
      const { service } = arrangeHappyPath({ encrypted: false });
      const values = captureInsertValues();

      await service.apply(APPLICANT, LISTING, {});

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ resumeSnapshot: null }),
      );
    });

    it('does not insert or notify when the chat send is refused', async () => {
      const { service, mocks } = arrangeHappyPath();
      mocks.chat.sendMessage.mockRejectedValue(
        new ForbiddenException('Messaging unavailable'),
      );

      await expect(
        service.apply(APPLICANT, LISTING, ENCRYPTED),
      ).rejects.toThrow(ForbiddenException);
      expect(db.insert).not.toHaveBeenCalled();
      expect(mocks.notifications.notify).not.toHaveBeenCalled();
    });

    it('409s and skips the notification when the insert loses the race', async () => {
      const { service, mocks } = arrangeHappyPath({ encrypted: false });
      db.insert.mockReturnValue(insertChain([]));
      // The re-read that resolves the winner's id.
      db.select.mockReturnValueOnce(chain([applicationRow()]));

      await expect(service.apply(APPLICANT, LISTING, {})).rejects.toThrow(
        ConflictException,
      );
      expect(mocks.notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('list scoping', () => {
    function whereSql(wheres: unknown[], index: number) {
      return new PgDialect().sqlToQuery(wheres[index] as never);
    }

    it('listMine filters by applicant and never by listing status', async () => {
      const sink = { wheres: [] as unknown[] };
      db.select
        .mockReturnValueOnce(capturingChain([], sink))
        .mockReturnValueOnce(capturingChain([{ value: 0 }], sink))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));
      const { service } = makeService(db);

      await service.listMine(APPLICANT, {});

      const { sql: text, params } = whereSql(sink.wheres, 0);
      expect(text).toContain('applicant_id');
      expect(params).toContain(APPLICANT);
      // A deleted job must still render (the tombstone rule), unlike the
      // likes/saves lists which filter `status != 'deleted'`.
      expect(text).not.toContain('deleted');
    });

    it('listReceived filters by poster', async () => {
      const sink = { wheres: [] as unknown[] };
      db.select
        .mockReturnValueOnce(capturingChain([], sink))
        .mockReturnValueOnce(capturingChain([{ value: 0 }], sink))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));
      const { service } = makeService(db);

      await service.listReceived(POSTER, {});

      const { sql: text, params } = whereSql(sink.wheres, 0);
      expect(text).toContain('poster_id');
      expect(params).toContain(POSTER);
    });

    it('narrows to one listing when listingId is given', async () => {
      const sink = { wheres: [] as unknown[] };
      db.select
        .mockReturnValueOnce(capturingChain([], sink))
        .mockReturnValueOnce(capturingChain([{ value: 0 }], sink))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));
      const { service } = makeService(db);

      await service.listMine(APPLICANT, { listingId: LISTING });

      const { params } = whereSql(sink.wheres, 0);
      expect(params).toContain(LISTING);
    });
  });

  describe('getOne', () => {
    it('404s for a non-participant', async () => {
      db.select.mockReturnValueOnce(chain([applicationRow()]));
      const { service } = makeService(db);

      await expect(service.getOne(STRANGER, APPLICATION)).rejects.toThrow(
        NotFoundException,
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    it('flips pending → viewed when the poster opens it', async () => {
      db.select
        .mockReturnValueOnce(chain([applicationRow()]))
        .mockReturnValueOnce(chain([jobRow()]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));
      db.update.mockReturnValue(
        updateChain([
          applicationRow({ status: 'viewed', viewedAt: new Date() }),
        ]),
      );
      const { service } = makeService(db);

      const detail = await service.getOne(POSTER, APPLICATION);

      expect(db.update).toHaveBeenCalledTimes(1);
      expect(detail.status).toBe('viewed');
    });

    it('never flips when the applicant reads their own', async () => {
      db.select
        .mockReturnValueOnce(chain([applicationRow()]))
        .mockReturnValueOnce(chain([jobRow()]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));
      const { service } = makeService(db);

      const detail = await service.getOne(APPLICANT, APPLICATION);

      expect(db.update).not.toHaveBeenCalled();
      expect(detail.status).toBe('pending');
      expect(detail.poster.id).toBe(POSTER);
    });

    it('serves the frozen snapshot, not a live résumé read', async () => {
      const snapshot = resumeDocument();
      db.select
        .mockReturnValueOnce(
          chain([applicationRow({ resumeSnapshot: snapshot })]),
        )
        .mockReturnValueOnce(chain([jobRow()]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));
      const { service, mocks } = makeService(db);

      const detail = await service.getOne(APPLICANT, APPLICATION);

      expect(detail.resume).toEqual(snapshot);
      expect(mocks.resume.getDocument).not.toHaveBeenCalled();
    });
  });

  describe('setStatus', () => {
    it('404s for the applicant — the poster owns the verdict', async () => {
      db.select.mockReturnValueOnce(chain([applicationRow()]));
      const { service } = makeService(db);

      await expect(
        service.setStatus(APPLICANT, APPLICATION, { status: 'hired' }),
      ).rejects.toThrow(NotFoundException);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('lets the poster hire', async () => {
      db.select.mockReturnValueOnce(chain([applicationRow()]));
      db.update.mockReturnValue(
        updateChain([{ id: APPLICATION, status: 'hired' }]),
      );
      const { service } = makeService(db);

      await expect(
        service.setStatus(POSTER, APPLICATION, { status: 'hired' }),
      ).resolves.toEqual({ id: APPLICATION, status: 'hired' });
    });
  });

  describe('signCv — the application-scoped résumé allow-list', () => {
    it('404s for a third party and never signs', async () => {
      db.select.mockReturnValueOnce(chain([applicationRow()]));
      const { service, mocks } = makeService(db);

      await expect(service.signCv(STRANGER, APPLICATION)).rejects.toThrow(
        NotFoundException,
      );
      expect(mocks.resumeAttachments.signAttachmentById).not.toHaveBeenCalled();
    });

    it('404s for the applicant — their CV lives at /me/resume', async () => {
      db.select.mockReturnValueOnce(
        chain([applicationRow({ resumeSnapshot: resumeDocument() })]),
      );
      const { service, mocks } = makeService(db);

      await expect(service.signCv(APPLICANT, APPLICATION)).rejects.toThrow(
        NotFoundException,
      );
      expect(mocks.resumeAttachments.signAttachmentById).not.toHaveBeenCalled();
    });

    it('409s when the application carried no CV', async () => {
      db.select.mockReturnValueOnce(
        chain([
          applicationRow({
            resumeSnapshot: resumeDocument({ attachment: null }),
          }),
        ]),
      );
      const { service } = makeService(db);

      await expect(service.signCv(POSTER, APPLICATION)).rejects.toMatchObject({
        response: { code: 'RESUME_CV_MISSING' },
      });
    });

    it('409s when the CV was removed or replaced since', async () => {
      db.select.mockReturnValueOnce(
        chain([applicationRow({ resumeSnapshot: resumeDocument() })]),
      );
      const { service, mocks } = makeService(db);
      mocks.resumeAttachments.signAttachmentById.mockResolvedValue(null);

      await expect(service.signCv(POSTER, APPLICATION)).rejects.toMatchObject({
        response: { code: 'RESUME_CV_REMOVED' },
      });
    });

    it('signs the snapshot’s attachment id for the poster', async () => {
      db.select.mockReturnValueOnce(
        chain([applicationRow({ resumeSnapshot: resumeDocument() })]),
      );
      const { service, mocks } = makeService(db);
      mocks.resumeAttachments.signAttachmentById.mockResolvedValue({
        url: 'https://signed',
        expiresAt: '2026-10-16T00:05:00Z',
      });

      await expect(service.signCv(POSTER, APPLICATION)).resolves.toEqual({
        url: 'https://signed',
        expiresAt: '2026-10-16T00:05:00Z',
      });
      expect(mocks.resumeAttachments.signAttachmentById).toHaveBeenCalledWith(
        ATTACHMENT,
      );
    });
  });
});
