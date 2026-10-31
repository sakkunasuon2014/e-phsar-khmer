import { AccountPurgeService } from './account-purge.service';

type MockDb = {
  select: jest.Mock;
  delete: jest.Mock;
  transaction: jest.Mock;
};

function makeDb(): MockDb {
  const db: MockDb = {
    select: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(),
  };
  db.transaction.mockImplementation((cb: (tx: MockDb) => unknown) => cb(db));
  return db;
}

/** The batch select chain: .select().from().where().orderBy().limit().for() */
function selectReturns(
  db: ReturnType<typeof makeDb>,
  batches: {
    id: string;
    profilePhotoUrl: string | null;
    coverPhotoUrl: string | null;
  }[][],
) {
  let call = 0;
  db.select.mockImplementation(() => {
    const rows = batches[call] ?? [];
    call++;
    return {
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({ for: () => Promise.resolve(rows) }),
          }),
        }),
      }),
    };
  });
}

function makeFiles() {
  return { removeByPublicUrl: jest.fn().mockResolvedValue(undefined) };
}

function makeConfig() {
  return {
    get: jest.fn((key: string) =>
      key === 'accounts.purgeEnabled' ? true : 60_000,
    ),
  };
}

describe('AccountPurgeService', () => {
  it('deletes the due rows and clears their storage objects', async () => {
    const db = makeDb();
    const files = makeFiles();
    selectReturns(db, [
      [
        {
          id: 'u1',
          profilePhotoUrl:
            'https://x.supabase.co/storage/v1/object/public/p/a.jpg',
          coverPhotoUrl: null,
        },
        { id: 'u2', profilePhotoUrl: null, coverPhotoUrl: null },
      ],
    ]);
    db.delete.mockReturnValue({ where: () => Promise.resolve([]) });

    const service = new AccountPurgeService(
      db as never,
      makeConfig() as never,
      files as never,
    );

    await expect(service.purgeDueAccounts()).resolves.toBe(2);
    expect(db.delete).toHaveBeenCalledTimes(1);
    // Only the one row that actually had an avatar.
    expect(files.removeByPublicUrl).toHaveBeenCalledTimes(1);
    expect(files.removeByPublicUrl).toHaveBeenCalledWith(
      'https://x.supabase.co/storage/v1/object/public/p/a.jpg',
    );
  });

  it('is a no-op when nothing is past the window', async () => {
    const db = makeDb();
    selectReturns(db, [[]]);

    const service = new AccountPurgeService(
      db as never,
      makeConfig() as never,
      makeFiles() as never,
    );

    await expect(service.purgeDueAccounts()).resolves.toBe(0);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('keeps going while a batch comes back full', async () => {
    const db = makeDb();
    const full = Array.from({ length: 200 }, (_, i) => ({
      id: `u${i}`,
      profilePhotoUrl: null,
      coverPhotoUrl: null,
    }));
    selectReturns(db, [full, []]);
    db.delete.mockReturnValue({ where: () => Promise.resolve([]) });

    const service = new AccountPurgeService(
      db as never,
      makeConfig() as never,
      makeFiles() as never,
    );

    await expect(service.purgeDueAccounts()).resolves.toBe(200);
    // The second round found nothing due, so it never issued a DELETE.
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('arms no interval in the test environment', () => {
    const db = makeDb();
    selectReturns(db, [[]]);
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    new AccountPurgeService(
      db as never,
      makeConfig() as never,
      makeFiles() as never,
    ).onModuleInit();

    // A live interval would outlive app.close() and keep test:e2e hanging.
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('arms one interval and clears it on shutdown elsewhere', () => {
    const db = makeDb();
    selectReturns(db, [[]]);
    const files = makeFiles();
    const originalEnv = process.env.NODE_ENV;
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockReturnValue({} as never);
    const clearIntervalSpy = jest
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined);

    process.env.NODE_ENV = 'development';
    try {
      const service = new AccountPurgeService(
        db as never,
        makeConfig() as never,
        files as never,
      );

      service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = originalEnv;
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('leaves boot alone and sweeps within two minutes', async () => {
    jest.useFakeTimers();
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const db = makeDb();
      selectReturns(db, [[]]);
      const service = new AccountPurgeService(
        db as never,
        {
          get: jest.fn((key: string) =>
            key === 'accounts.purgeEnabled' ? true : 6 * 60 * 60 * 1000,
          ),
        } as never,
        makeFiles() as never,
      );

      service.onModuleInit();
      // A restart loop must not turn into a query loop.
      expect(db.select).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(db.select).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
    } finally {
      process.env.NODE_ENV = originalEnv;
      jest.useRealTimers();
    }
  });

  it('cancels the pending first sweep on shutdown', async () => {
    jest.useFakeTimers();
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const db = makeDb();
      selectReturns(db, [[]]);
      const service = new AccountPurgeService(
        db as never,
        {
          get: jest.fn((key: string) =>
            key === 'accounts.purgeEnabled' ? true : 6 * 60 * 60 * 1000,
          ),
        } as never,
        makeFiles() as never,
      );

      service.onModuleInit();
      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(db.select).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
      jest.useRealTimers();
    }
  });

  it('disarms when the deployment runs purge-disabled', () => {
    const db = makeDb();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    new AccountPurgeService(
      db as never,
      { get: jest.fn().mockReturnValue(false) } as never,
      makeFiles() as never,
    ).onModuleInit();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
