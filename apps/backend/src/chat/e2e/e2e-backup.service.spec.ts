import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  E2eBackupService,
  hashKeyProof,
  PASSCODE_MAX_ATTEMPTS,
} from './e2e-backup.service';

// .set().where().returning() → rows
function updateReturning(rows: unknown[], sets: unknown[] = []) {
  return {
    set: (v: unknown) => {
      sets.push(v);
      return {
        where: () => {
          const p = Promise.resolve(undefined) as Promise<undefined> & {
            returning: () => Promise<unknown[]>;
          };
          p.returning = () => Promise.resolve(rows);
          return p;
        },
      };
    },
  };
}

// .from().where().limit() → rows
function limitQuery(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  };
}

// .from().where().orderBy().limit() → rows
function listQuery(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
  };
}

function makeDb() {
  return { select: jest.fn(), update: jest.fn(), insert: jest.fn() };
}

const pubsub = { publish: jest.fn() };
beforeEach(() => {
  pubsub.publish.mockReset().mockResolvedValue(undefined);
});

describe('E2eBackupService.unlock', () => {
  let authHash: string;
  beforeAll(async () => {
    authHash = await bcrypt.hash('right-auth-key', 4);
  });

  it('returns the wrapped key and resets the counter on the right passcode', async () => {
    const db = makeDb();
    const sets: unknown[] = [];
    db.update
      .mockReturnValueOnce(
        updateReturning([
          { passcodeAuthHash: authHash, wrappedKey: 'wk', failedAttempts: 1 },
        ]),
      )
      .mockReturnValueOnce(updateReturning([], sets));
    const service = new E2eBackupService(db as never, pubsub as never);

    await expect(service.unlock('u1', 'right-auth-key')).resolves.toEqual({
      wrappedKey: 'wk',
    });
    expect(sets[0]).toEqual({ failedAttempts: 0, lockedUntil: null });
  });

  it('rejects a wrong passcode with attemptsLeft, no lock yet', async () => {
    const db = makeDb();
    db.update.mockReturnValueOnce(
      updateReturning([
        { passcodeAuthHash: authHash, wrappedKey: 'wk', failedAttempts: 2 },
      ]),
    );
    const service = new E2eBackupService(db as never, pubsub as never);

    const err = await service.unlock('u1', 'wrong').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'E2E_PASSCODE_WRONG',
      details: { attemptsLeft: PASSCODE_MAX_ATTEMPTS - 2, lockedUntil: null },
    });
    expect(db.update).toHaveBeenCalledTimes(1); // no lock write
  });

  it('locks the backup on the last allowed wrong attempt', async () => {
    const db = makeDb();
    const sets: { lockedUntil?: Date }[] = [];
    db.update
      .mockReturnValueOnce(
        updateReturning([
          {
            passcodeAuthHash: authHash,
            wrappedKey: 'wk',
            failedAttempts: PASSCODE_MAX_ATTEMPTS,
          },
        ]),
      )
      .mockReturnValueOnce(updateReturning([], sets));
    const service = new E2eBackupService(db as never, pubsub as never);

    const err = await service.unlock('u1', 'wrong').catch((e: unknown) => e);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      details: { attemptsLeft: 0 },
    });
    const lockedUntil = sets[0].lockedUntil!;
    expect(lockedUntil.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
  });

  it('refuses with 429 while locked, without comparing', async () => {
    const db = makeDb();
    const lockedUntil = new Date(Date.now() + 3_600_000);
    db.update.mockReturnValueOnce(updateReturning([])); // guarded UPDATE matched nothing
    db.select.mockReturnValueOnce(
      limitQuery([
        {
          keyCheck: 'kc',
          wrappedKey: 'wk',
          passcodeAuthHash: authHash,
          lockedUntil,
        },
      ]),
    );
    const service = new E2eBackupService(db as never, pubsub as never);

    const err = await service
      .unlock('u1', 'right-auth-key')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: 'E2E_PASSCODE_LOCKED',
    });
  });

  it('404s when no passcode was ever set', async () => {
    const db = makeDb();
    db.update.mockReturnValueOnce(updateReturning([]));
    db.select.mockReturnValueOnce(
      limitQuery([
        { keyCheck: 'kc', wrappedKey: null, passcodeAuthHash: null },
      ]),
    );
    const service = new E2eBackupService(db as never, pubsub as never);

    await expect(service.unlock('u1', 'x')).rejects.toThrow(NotFoundException);
  });
});

describe('E2eBackupService.setPasscode', () => {
  it('409s when the caller holds a different backup key', async () => {
    const db = makeDb();
    db.update.mockReturnValueOnce(updateReturning([]));
    const service = new E2eBackupService(db as never, pubsub as never);

    await expect(
      service.setPasscode('u1', {
        keyCheck: 'stale',
        keyProof: 'kp',
        salt: 's',
        params: { alg: 'argon2id', t: 2, m: 19456, p: 1 },
        wrappedKey: 'wk',
        authKey: 'ak',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('stores a bcrypt hash of the auth key, never the key itself', async () => {
    const db = makeDb();
    const sets: Record<string, unknown>[] = [];
    db.update.mockReturnValueOnce(updateReturning([{ userId: 'u1' }], sets));
    const service = new E2eBackupService(db as never, pubsub as never);

    await service.setPasscode('u1', {
      keyCheck: 'kc',
      keyProof: 'kp',
      salt: 's',
      params: { alg: 'argon2id', t: 2, m: 19456, p: 1 },
      wrappedKey: 'wk',
      authKey: 'secret-auth',
    });
    const stored = sets[0].passcodeAuthHash as string;
    expect(stored).not.toBe('secret-auth');
    await expect(bcrypt.compare('secret-auth', stored)).resolves.toBe(true);
    expect(sets[0]).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('stores the proof hash, never the proof itself', async () => {
    const db = makeDb();
    const sets: Record<string, unknown>[] = [];
    db.update.mockReturnValueOnce(updateReturning([{ userId: 'u1' }], sets));
    const service = new E2eBackupService(db as never, pubsub as never);

    await service.setPasscode('u1', {
      keyCheck: 'kc',
      keyProof: 'secret-proof',
      salt: 's',
      params: { alg: 'argon2id', t: 2, m: 19456, p: 1 },
      wrappedKey: 'wk',
      authKey: 'ak',
    });
    expect(sets[0].keyProofHash).toBe(hashKeyProof('secret-proof'));
    expect(sets[0].keyProofHash).not.toBe('secret-proof');
  });

  it('409s a caller who knows the public keyCheck but not the proof', async () => {
    // The guarded UPDATE matches nothing when the proof hash differs.
    const db = makeDb();
    db.update.mockReturnValueOnce(updateReturning([]));
    const service = new E2eBackupService(db as never, pubsub as never);

    const err = await service
      .setPasscode('u1', {
        keyCheck: 'kc',
        keyProof: 'forged',
        salt: 's',
        params: { alg: 'argon2id', t: 2, m: 19456, p: 1 },
        wrappedKey: 'attacker-wk',
        authKey: 'attacker-ak',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'E2E_BACKUP_KEY_MISMATCH',
    });
  });
});

describe('E2eBackupService.init', () => {
  it('stores keyCheck and the proof hash, never the raw proof', async () => {
    const db = makeDb();
    const values: Record<string, unknown>[] = [];
    db.select
      .mockReturnValueOnce(limitQuery([{ id: 'd1' }])) // assertOwnDevice
      .mockReturnValueOnce(limitQuery([{ keyCheck: 'kc' }])); // getStatus
    db.insert.mockReturnValueOnce({
      values: (v: Record<string, unknown>) => {
        values.push(v);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ userId: 'u1' }]),
          }),
        };
      },
    });
    const service = new E2eBackupService(db as never, pubsub as never);

    const res = await service.init('u1', {
      deviceId: 'd1',
      keyCheck: 'kc',
      keyProof: 'secret-proof',
    });

    expect(values[0]).toEqual({
      userId: 'u1',
      keyCheck: 'kc',
      keyProofHash: hashKeyProof('secret-proof'),
    });
    expect(res).toMatchObject({ created: true, keyCheck: 'kc' });
    // getStatus must never leak the hash
    expect(res).not.toHaveProperty('keyProofHash');
  });

  it("404s a device that is not one of the caller's active devices", async () => {
    const db = makeDb();
    db.select.mockReturnValueOnce(limitQuery([])); // assertOwnDevice
    const service = new E2eBackupService(db as never, pubsub as never);

    await expect(
      service.init('u1', {
        deviceId: 'foreign-device',
        keyCheck: 'kc',
        keyProof: 'kp',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('E2eBackupService.listSegments', () => {
  it("404s a device that isn't the caller's active device", async () => {
    const db = makeDb();
    db.select.mockReturnValueOnce(limitQuery([])); // assertOwnDevice
    const service = new E2eBackupService(db as never, pubsub as never);

    await expect(
      service.listSegments('u1', { deviceId: 'foreign-device' }),
    ).rejects.toThrow(NotFoundException);
    // The paging query must never run.
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('pages the caller device backlog and returns an opaque latest cursor', async () => {
    const db = makeDb();
    const createdAt = new Date('2026-10-24T00:00:00.000Z');
    db.select
      .mockReturnValueOnce(limitQuery([{ id: 'd1' }])) // assertOwnDevice
      .mockReturnValueOnce(
        listQuery([{ id: 's1', ciphertext: 'c1', messageCount: 2, createdAt }]),
      );
    const service = new E2eBackupService(db as never, pubsub as never);

    const page = await service.listSegments('u1', { deviceId: 'd1' });

    expect(page.items).toEqual([
      { id: 's1', ciphertext: 'c1', messageCount: 2 },
    ]);
    expect(page.nextCursor).toBeNull();
    expect(
      JSON.parse(Buffer.from(page.latestCursor!, 'base64').toString('utf8')),
    ).toEqual({ createdAt: createdAt.toISOString(), id: 's1' });
  });
});

describe('hashKeyProof', () => {
  it('is deterministic hex sha256', () => {
    expect(hashKeyProof('x')).toBe(hashKeyProof('x'));
    expect(hashKeyProof('x')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKeyProof('x')).not.toBe(hashKeyProof('y'));
  });
});

describe('E2eBackupService realtime hints', () => {
  function insertReturning(rows: unknown[]) {
    return {
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => Promise.resolve(rows) }),
        returning: () => Promise.resolve(rows),
      }),
    };
  }

  it('announces an uploaded segment by device id only, never its ciphertext', async () => {
    const db = makeDb();
    db.select.mockReturnValueOnce(limitQuery([{ id: 'd1' }]));
    db.insert.mockReturnValueOnce(insertReturning([{ id: 's1' }]));
    const service = new E2eBackupService(db as never, pubsub as never);

    await service.addSegment('u1', {
      deviceId: 'd1',
      ciphertext: 'SECRET-CIPHERTEXT',
      messageCount: 3,
    });

    expect(pubsub.publish).toHaveBeenCalledWith({
      targetUserId: 'u1',
      type: 'notification',
      payload: { type: 'e2e.backup_updated', data: { deviceId: 'd1' } },
    });
    expect(JSON.stringify(pubsub.publish.mock.calls)).not.toContain(
      'SECRET-CIPHERTEXT',
    );
  });

  it('does not fail the write when the push itself fails', async () => {
    const db = makeDb();
    db.select.mockReturnValueOnce(limitQuery([{ id: 'd1' }]));
    db.insert.mockReturnValueOnce(insertReturning([{ id: 's1' }]));
    pubsub.publish.mockRejectedValueOnce(new Error('redis down'));
    const service = new E2eBackupService(db as never, pubsub as never);

    await expect(
      service.addSegment('u1', {
        deviceId: 'd1',
        ciphertext: 'c',
        messageCount: 1,
      }),
    ).resolves.toEqual({ id: 's1' });
  });
});
