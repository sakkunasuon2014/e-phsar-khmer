import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PgDialect } from 'drizzle-orm/pg-core';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

jest.mock('bcrypt');

type MockDb = {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  transaction: jest.Mock;
};

function makeDb(): MockDb {
  const db: MockDb = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(),
  };
  // Runs the callback against the same mock, so a transactional method is
  // exercised exactly like a non-transactional one.
  db.transaction.mockImplementation((cb: (tx: MockDb) => unknown) => cb(db));
  return db;
}

function makeService(
  db: ReturnType<typeof makeDb>,
  supabase: Record<string, jest.Mock> = {},
  notifications: Record<string, jest.Mock> = {
    notify: jest.fn().mockResolvedValue(undefined),
  },
) {
  const filesService = {
    removeByPublicUrl: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UsersService(
    db as never,
    supabase as never,
    {} as never,
    filesService as never,
    notifications as never,
  );
  (service as unknown as { db: unknown }).db = db;
  return service;
}

/**
 * A chainable query stub that is also awaitable, so one shape serves both
 * `…where()` (awaited directly, as the count/hydrate queries are) and
 * `…where().orderBy().limit().offset()` (the paged edge query).
 */
function chain<T>(result: T[]) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self;
  c.where = self;
  c.orderBy = self;
  c.limit = self;
  c.offset = self;
  c.returning = () => Promise.resolve(result);
  c.then = (resolve: (value: T[]) => unknown) =>
    Promise.resolve(result).then(resolve);
  return c;
}

describe('UsersService phone management', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db);
  });

  describe('addPhone', () => {
    it('inserts with isPrimary=true when no existing phones', async () => {
      let callCount = 0;
      db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            from: () => ({
              where: () => ({ limit: () => Promise.resolve([]) }),
            }),
          };
        }
        return {
          from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        };
      });
      db.update.mockReturnValue({
        set: () => ({ where: () => Promise.resolve([]) }),
      });
      const created = {
        id: 'p1',
        userId: 'u1',
        phone: '+855123',
        isPrimary: true,
      };
      db.insert.mockReturnValue({
        values: () => ({ returning: () => Promise.resolve([created]) }),
      });

      const result = await service.addPhone('u1', { phone: '+855123' });
      expect(result.isPrimary).toBe(true);
    });

    it('throws ConflictException when phone already in use', async () => {
      let selectCall = 0;
      db.select.mockImplementation(() => {
        selectCall++;
        // 1: banned-phone lookup → not banned; 2: phone owner check
        const rows = selectCall === 1 ? [] : [{ id: 'existing' }];
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        };
      });

      await expect(
        service.addPhone('u1', { phone: '+855123' }),
      ).rejects.toThrow(ConflictException);
    });

    it('demotes other phones when isPrimary=true on second phone', async () => {
      let selectCall = 0;
      db.select.mockImplementation(() => {
        selectCall++;
        // 1: banned-phone lookup, 2: existing-phone check — both empty;
        // 3: hasAny (this user already has a phone)
        if (selectCall <= 2) {
          return {
            from: () => ({
              where: () => ({ limit: () => Promise.resolve([]) }),
            }),
          };
        }
        return {
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: 'existing' }]),
            }),
          }),
        };
      });

      const updateWhere = jest.fn().mockResolvedValue([]);
      db.update.mockReturnValue({ set: () => ({ where: updateWhere }) });

      const created = {
        id: 'p2',
        userId: 'u1',
        phone: '+855999',
        isPrimary: true,
      };
      db.insert.mockReturnValue({
        values: () => ({ returning: () => Promise.resolve([created]) }),
      });

      await service.addPhone('u1', { phone: '+855999', isPrimary: true });
      expect(updateWhere).toHaveBeenCalled();
    });
  });

  describe('updatePhone', () => {
    const savedPhone = {
      id: 'p1',
      userId: 'u1',
      phone: '+855111',
      isPrimary: false,
    };

    it('edits the contact number without touching users.primaryPhone', async () => {
      let selectCall = 0;
      db.select.mockImplementation(() => {
        selectCall++;
        // 1: banned lookup; 2: ownership; 3: duplicate check
        const rows = selectCall === 2 ? [savedPhone] : [];
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        };
      });
      let updateSet: Record<string, unknown> | undefined;
      db.update.mockReturnValue({
        set: (arg: Record<string, unknown>) => {
          updateSet = arg;
          return {
            where: () => ({
              returning: () =>
                Promise.resolve([{ ...savedPhone, phone: '+855222' }]),
            }),
          };
        },
      });

      const result = await service.updatePhone('u1', 'p1', {
        phone: '+855222',
      });

      expect(result.phone).toBe('+855222');
      expect(updateSet).toEqual({ phone: '+855222' });
      // Only the user_phones row is written — the login phone stays put.
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('returns the row unchanged when the number did not move', async () => {
      let selectCall = 0;
      db.select.mockImplementation(() => {
        selectCall++;
        const rows = selectCall === 2 ? [savedPhone] : [];
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        };
      });

      const result = await service.updatePhone('u1', 'p1', {
        phone: '+855111',
      });

      expect(result).toEqual(savedPhone);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the row is not the caller’s', async () => {
      // Both the banned lookup and the ownership lookup come back empty.
      db.select.mockImplementation(() => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      }));

      await expect(
        service.updatePhone('u1', 'p-other', { phone: '+855222' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when another row owns the number', async () => {
      let selectCall = 0;
      db.select.mockImplementation(() => {
        selectCall++;
        const rows =
          selectCall === 1
            ? []
            : selectCall === 2
              ? [savedPhone]
              : [{ id: 'p-other' }];
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        };
      });

      await expect(
        service.updatePhone('u1', 'p1', { phone: '+855222' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('setPrimaryPhone', () => {
    it('throws NotFoundException when phone not found or wrong owner', async () => {
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      });

      await expect(
        service.setPrimaryPhone('u1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('demotes all phones then promotes target', async () => {
      const target = {
        id: 'p1',
        userId: 'u1',
        phone: '+855123',
        isPrimary: false,
      };
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([target]) }),
        }),
      });

      const promotedRow = { ...target, isPrimary: true };
      let updateCallCount = 0;
      db.update.mockImplementation(() => ({
        set: () => ({
          where: () => {
            updateCallCount++;
            if (updateCallCount === 1) {
              // first call: demote all — no .returning()
              return Promise.resolve([]);
            }
            // second call: promote target — returns object with .returning()
            return { returning: () => Promise.resolve([promotedRow]) };
          },
        }),
      }));

      const result = await service.setPrimaryPhone('u1', 'p1');
      expect(result.isPrimary).toBe(true);
    });
  });

  describe('removePhone', () => {
    const phone = (id: string, isPrimary: boolean) => ({
      id,
      userId: 'u1',
      phone: `+855${id}`,
      isPrimary,
    });
    const phonesQuery = (rows: object[]) => ({
      from: () => ({ where: () => ({ for: () => Promise.resolve(rows) }) }),
    });

    it('throws NotFoundException for a phone the user does not own', async () => {
      db.select.mockReturnValue(phonesQuery([phone('p2', true)]));

      await expect(service.removePhone('u1', 'p1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to remove the only phone', async () => {
      db.select.mockReturnValue(phonesQuery([phone('p1', true)]));

      await expect(service.removePhone('u1', 'p1')).rejects.toThrow(
        BadRequestException,
      );
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('removes a secondary phone without touching the primary', async () => {
      db.select.mockReturnValue(
        phonesQuery([phone('p1', true), phone('p2', false)]),
      );
      db.delete.mockReturnValue({ where: () => Promise.resolve([]) });

      const result = await service.removePhone('u1', 'p2');
      expect(result).toEqual({ removed: true });
      expect(db.update).not.toHaveBeenCalled();
    });

    it('promotes another phone and moves primaryPhone when the primary goes', async () => {
      db.select.mockReturnValue(
        phonesQuery([phone('p1', true), phone('p2', false)]),
      );
      db.delete.mockReturnValue({ where: () => Promise.resolve([]) });
      const sets: unknown[] = [];
      db.update.mockReturnValue({
        set: (v: unknown) => {
          sets.push(v);
          return { where: () => Promise.resolve([]) };
        },
      });

      await service.removePhone('u1', 'p1');
      expect(sets[0]).toEqual({ isPrimary: true });
      expect(sets[1]).toMatchObject({ primaryPhone: '+855p2' });
    });
  });

  it('addPhone maps a concurrent duplicate (23505) to ConflictException', async () => {
    db.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    db.update.mockReturnValue({
      set: () => ({ where: () => Promise.resolve([]) }),
    });
    db.insert.mockReturnValue({
      values: () => ({
        returning: () =>
          Promise.reject(
            Object.assign(new Error('duplicate'), { code: '23505' }),
          ),
      }),
    });

    await expect(service.addPhone('u1', { phone: '+855123' })).rejects.toThrow(
      ConflictException,
    );
  });
});

const fakeUser = {
  id: 'u1',
  username: null,
  passwordHash: null,
  primaryPhone: null,
  email: null,
  firstName: null,
  lastName: null,
  gender: null,
  dateOfBirth: null,
  yearOfBirth: null,
  company: null,
  coverPhotoUrl: null,
  profilePhotoUrl: null,
  provinceId: null as string | null,
  districtId: null as string | null,
  communeId: null as string | null,
  address: null,
  latitude: null,
  longitude: null,
  preferredLanguage: 'en',
  role: 'user' as const,
  status: 'active' as const,
  isBusiness: false,
  discoverableByGender: false,
  discoverableByDateOfBirth: false,
  discoverableByPhone: true,
  discoverableByEmail: true,
  discoverableByLocation: true,
  lastSeenAt: null,
  emailVerifiedAt: null,
  phoneVerifiedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UsersService updateProfile location validation', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db);
  });

  it('skips DB location check when no location fields in DTO', async () => {
    db.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ ...fakeUser, company: 'X' }]),
        }),
      }),
    });

    await service.updateProfile('u1', { company: 'X' });

    expect(db.select).not.toHaveBeenCalled();
  });

  it('accepts districtId that belongs to provided provinceId', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ ...fakeUser }]) }),
          }),
        };
      }
      // district validation → provinceId matches
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ provinceId: 'prov-1' }]),
          }),
        }),
      };
    });
    db.update.mockReturnValue({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([{ ...fakeUser }]) }),
      }),
    });

    await expect(
      service.updateProfile('u1', {
        provinceId: 'prov-1',
        districtId: 'dist-1',
      }),
    ).resolves.toBeDefined();
  });

  it('throws INVALID_LOCATION_HIERARCHY when districtId does not belong to provinceId', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ ...fakeUser }]) }),
          }),
        };
      }
      // district belongs to a different province
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ provinceId: 'prov-OTHER' }]),
          }),
        }),
      };
    });

    await expect(
      service.updateProfile('u1', {
        provinceId: 'prov-1',
        districtId: 'dist-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when provinceId changes and existing districtId no longer belongs', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  { ...fakeUser, provinceId: 'prov-old', districtId: 'dist-1' },
                ]),
            }),
          }),
        };
      }
      // district still belongs to prov-old, not prov-new
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ provinceId: 'prov-old' }]),
          }),
        }),
      };
    });

    await expect(
      service.updateProfile('u1', { provinceId: 'prov-new' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts communeId that belongs to the effective districtId', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([{ ...fakeUser, districtId: 'dist-1' }]),
            }),
          }),
        };
      }
      // commune validation → districtId matches
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ districtId: 'dist-1' }]),
          }),
        }),
      };
    });
    db.update.mockReturnValue({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([{ ...fakeUser }]) }),
      }),
    });

    await expect(
      service.updateProfile('u1', { communeId: 'commune-1' }),
    ).resolves.toBeDefined();
  });

  it('throws INVALID_LOCATION_HIERARCHY when communeId does not belong to districtId', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([{ ...fakeUser, districtId: 'dist-1' }]),
            }),
          }),
        };
      }
      // commune belongs to a different district
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ districtId: 'dist-OTHER' }]),
          }),
        }),
      };
    });

    await expect(
      service.updateProfile('u1', { communeId: 'commune-wrong' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('UsersService updateProfile ads contact sync', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db);
  });

  it('writes NULL (not the string "null") when the map pin is cleared', async () => {
    let updateSet: Record<string, unknown> | undefined;
    db.update.mockReturnValue({
      set: (arg: Record<string, unknown>) => {
        updateSet = arg;
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser }]),
          }),
        };
      },
    });

    await service.updateProfile('u1', { latitude: null, longitude: null });

    expect(updateSet?.latitude).toBeNull();
    expect(updateSet?.longitude).toBeNull();
  });

  it('copies the contact block and location to the user listings when asked', async () => {
    const user = {
      ...fakeUser,
      username: 'sokdara',
      firstName: 'Sok',
      lastName: 'Dara',
      email: 'dara@example.com',
      primaryPhone: '+855111',
      provinceId: 'p1',
      districtId: 'd1',
      communeId: 'c1',
      address: 'House no. 1',
      latitude: '11.5564000',
      longitude: '104.9282000',
    };
    const sets: Record<string, unknown>[] = [];
    db.update.mockReturnValue({
      set: (arg: Record<string, unknown>) => {
        sets.push(arg);
        return {
          where: () => ({
            returning: () => Promise.resolve([user]),
          }),
        };
      },
    });
    db.select.mockReturnValue(
      chain([
        { phone: '+855222', isPrimary: false },
        { phone: '+855111', isPrimary: true },
      ]),
    );

    await service.updateProfile('u1', { updateAdsContact: true });

    expect(sets).toHaveLength(2);
    expect(sets[1]).toMatchObject({
      contactName: 'Sok Dara',
      contactPhones: ['+855111', '+855222'],
      contactEmail: 'dara@example.com',
      provinceId: 'p1',
      districtId: 'd1',
      communeId: 'c1',
      address: 'House no. 1',
      latitude: '11.5564000',
      longitude: '104.9282000',
    });
  });

  it('leaves an ad pin alone when the profile has no pin', async () => {
    const user = { ...fakeUser, username: 'sokdara', primaryPhone: '+855111' };
    const sets: Record<string, unknown>[] = [];
    db.update.mockReturnValue({
      set: (arg: Record<string, unknown>) => {
        sets.push(arg);
        return {
          where: () => ({
            returning: () => Promise.resolve([user]),
          }),
        };
      },
    });
    db.select.mockReturnValue(chain([]));

    await service.updateProfile('u1', { updateAdsContact: true });

    // The cascade and address still mirror the profile (here: cleared), but a
    // pinless account must never wipe the coordinate pair an ad carries.
    expect(sets[1]).toMatchObject({ provinceId: null, address: null });
    expect(sets[1]).not.toHaveProperty('latitude');
    expect(sets[1]).not.toHaveProperty('longitude');
  });

  it('falls back to primaryPhone when the account has no phone rows', async () => {
    const user = {
      ...fakeUser,
      username: 'sokdara',
      primaryPhone: '+855111',
    };
    const sets: Record<string, unknown>[] = [];
    db.update.mockReturnValue({
      set: (arg: Record<string, unknown>) => {
        sets.push(arg);
        return {
          where: () => ({
            returning: () => Promise.resolve([user]),
          }),
        };
      },
    });
    db.select.mockReturnValue(chain([]));

    await service.updateProfile('u1', { updateAdsContact: true });

    expect(sets[1].contactPhones).toEqual(['+855111']);
    expect(sets[1].contactName).toBe('sokdara');
  });

  it('does not touch listings when the checkbox is off', async () => {
    db.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ ...fakeUser }]),
        }),
      }),
    });

    await service.updateProfile('u1', { company: 'X' });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('UsersService updateProfile date of birth', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db);
  });

  function mockUpdate() {
    const sets: Record<string, unknown>[] = [];
    db.update.mockReturnValue({
      set: (arg: Record<string, unknown>) => {
        sets.push(arg);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser }]),
          }),
        };
      },
    });
    return sets;
  }

  it('stores the day and derives the legacy year', async () => {
    const sets = mockUpdate();

    await service.updateProfile('u1', { dateOfBirth: '1995-04-17' });

    expect(sets[0].dateOfBirth).toBe('1995-04-17');
    expect(sets[0].yearOfBirth).toBe(1995);
  });

  it('clears both representations when null', async () => {
    const sets = mockUpdate();

    await service.updateProfile('u1', {
      dateOfBirth: null,
      // The full date is authoritative, so an explicit stale year loses.
      yearOfBirth: 1990,
    });

    expect(sets[0].dateOfBirth).toBeNull();
    expect(sets[0].yearOfBirth).toBeNull();
  });

  it('rejects a future birthday', async () => {
    mockUpdate();

    await expect(
      service.updateProfile('u1', { dateOfBirth: '2999-01-01' }),
    ).rejects.toThrow(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('UsersService updateProfile privacy settings', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db);
  });

  function mockUpdate() {
    const sets: Record<string, unknown>[] = [];
    db.update.mockReturnValue({
      set: (arg: Record<string, unknown>) => {
        sets.push(arg);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser, ...arg }]),
          }),
        };
      },
    });
    return sets;
  }

  it('writes only the toggle carried by the patch', async () => {
    const sets = mockUpdate();

    const result = await service.updateProfile('u1', {
      discoverableByEmail: false,
    });

    expect(sets[0]).toMatchObject({ discoverableByEmail: false });
    expect(sets[0]).not.toHaveProperty('discoverableByPhone');
    expect(sets[0]).not.toHaveProperty('discoverableByLocation');
    expect(sets[0].updatedAt).toBeInstanceOf(Date);
    expect(result.discoverableByEmail).toBe(false);
  });

  it('writes all five when all five are sent', async () => {
    const sets = mockUpdate();

    await service.updateProfile('u1', {
      discoverableByGender: true,
      discoverableByDateOfBirth: true,
      discoverableByPhone: false,
      discoverableByEmail: false,
      discoverableByLocation: false,
    });

    expect(sets[0]).toMatchObject({
      discoverableByGender: true,
      discoverableByDateOfBirth: true,
      discoverableByPhone: false,
      discoverableByEmail: false,
      discoverableByLocation: false,
    });
  });

  it('does not pre-read the profile for a privacy-only patch', async () => {
    mockUpdate();

    await service.updateProfile('u1', { discoverableByPhone: false });

    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('UpdateProfileDto privacy validation', () => {
  it('rejects a non-boolean privacy value', async () => {
    const errors = await validate(
      plainToInstance(UpdateProfileDto, { discoverableByEmail: 'yes' }),
    );

    expect(errors.some((e) => e.property === 'discoverableByEmail')).toBe(true);
  });

  it('accepts booleans', async () => {
    const errors = await validate(
      plainToInstance(UpdateProfileDto, { discoverableByEmail: false }),
    );

    expect(errors).toHaveLength(0);
  });

  it.each(['en', 'km'])('accepts preferredLanguage %s', async (language) => {
    const errors = await validate(
      plainToInstance(UpdateProfileDto, { preferredLanguage: language }),
    );

    expect(errors).toHaveLength(0);
  });

  it.each(['zh', 'ko', 'id', 'vi'])(
    'rejects preferredLanguage %s',
    async (language) => {
      const errors = await validate(
        plainToInstance(UpdateProfileDto, { preferredLanguage: language }),
      );

      expect(errors.some((e) => e.property === 'preferredLanguage')).toBe(true);
    },
  );
});

describe('UsersService updateProfile username generation', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db);
  });

  it('generates when free', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        // current-user fetch
        return {
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ ...fakeUser, username: null }]),
            }),
          }),
        };
      }
      // collision check: johndoe → free
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      };
    });

    let capturedUpdateData: Record<string, unknown> = {};
    db.update.mockImplementation(() => ({
      set: (data: Record<string, unknown>) => {
        capturedUpdateData = data;
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser, ...data }]),
          }),
        };
      },
    }));

    await service.updateProfile('u1', { firstName: 'John', lastName: 'Doe' });
    expect(capturedUpdateData.username).toBe('johndoe');
  });

  it('appends suffix on collision', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ ...fakeUser, username: null }]),
            }),
          }),
        };
      }
      if (selectCall === 2) {
        // johndoe → taken
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ id: 'x' }]) }),
          }),
        };
      }
      // johndoe2 → free
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      };
    });

    let capturedUpdateData: Record<string, unknown> = {};
    db.update.mockImplementation(() => ({
      set: (data: Record<string, unknown>) => {
        capturedUpdateData = data;
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser, ...data }]),
          }),
        };
      },
    }));

    await service.updateProfile('u1', { firstName: 'John', lastName: 'Doe' });
    expect(capturedUpdateData.username).toBe('johndoe2');
  });

  it('tries multiple suffixes on multiple collisions', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ ...fakeUser, username: null }]),
            }),
          }),
        };
      }
      if (selectCall === 2 || selectCall === 3) {
        // johndoe and johndoe2 → taken
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ id: 'x' }]) }),
          }),
        };
      }
      // johndoe3 → free
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      };
    });

    let capturedUpdateData: Record<string, unknown> = {};
    db.update.mockImplementation(() => ({
      set: (data: Record<string, unknown>) => {
        capturedUpdateData = data;
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser, ...data }]),
          }),
        };
      },
    }));

    await service.updateProfile('u1', { firstName: 'John', lastName: 'Doe' });
    expect(capturedUpdateData.username).toBe('johndoe3');
  });

  it('does not overwrite an existing username', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([{ ...fakeUser, username: 'existing' }]),
            }),
          }),
        };
      }
      // should never reach collision check
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      };
    });

    let capturedUpdateData: Record<string, unknown> = {};
    db.update.mockImplementation(() => ({
      set: (data: Record<string, unknown>) => {
        capturedUpdateData = data;
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser, ...data }]),
          }),
        };
      },
    }));

    await service.updateProfile('u1', { firstName: 'John', lastName: 'Doe' });
    expect(capturedUpdateData.username).toBeUndefined();
    // only one select call: current-user fetch; no collision-check select
    expect(selectCall).toBe(1);
  });

  it('generates from firstName only', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ ...fakeUser, username: null }]),
            }),
          }),
        };
      }
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      };
    });

    let capturedUpdateData: Record<string, unknown> = {};
    db.update.mockImplementation(() => ({
      set: (data: Record<string, unknown>) => {
        capturedUpdateData = data;
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser, ...data }]),
          }),
        };
      },
    }));

    await service.updateProfile('u1', { firstName: 'John' });
    expect(capturedUpdateData.username).toBe('john');
  });

  it('generates from lastName only', async () => {
    let selectCall = 0;
    db.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ ...fakeUser, username: null }]),
            }),
          }),
        };
      }
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      };
    });

    let capturedUpdateData: Record<string, unknown> = {};
    db.update.mockImplementation(() => ({
      set: (data: Record<string, unknown>) => {
        capturedUpdateData = data;
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser, ...data }]),
          }),
        };
      },
    }));

    await service.updateProfile('u1', { lastName: 'Doe' });
    expect(capturedUpdateData.username).toBe('doe');
  });

  it('skips generation when no name field in DTO', async () => {
    db.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ ...fakeUser, company: 'X' }]),
        }),
      }),
    });

    await service.updateProfile('u1', { company: 'X' });

    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('UsersService blocks', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db);
  });

  describe('blockUser', () => {
    it('throws BadRequestException when blocking yourself', async () => {
      await expect(service.blockUser('u1', { userId: 'u1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(db.select).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when target is missing or soft-deleted', async () => {
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      });

      await expect(service.blockUser('u1', { userId: 'u2' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('inserts idempotently and returns { blocked: true }', async () => {
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ id: 'u2' }]) }),
        }),
      });
      const onConflictDoNothing = jest.fn().mockResolvedValue([]);
      db.insert.mockReturnValue({ values: () => ({ onConflictDoNothing }) });

      const result = await service.blockUser('u1', { userId: 'u2' });

      expect(result).toEqual({ blocked: true });
      expect(onConflictDoNothing).toHaveBeenCalled();
    });
  });

  describe('unblockUser', () => {
    it('throws NotFoundException when no block exists', async () => {
      db.delete.mockReturnValue({
        where: () => ({ returning: () => Promise.resolve([]) }),
      });

      await expect(service.unblockUser('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns { removed: true } when the block is deleted', async () => {
      db.delete.mockReturnValue({
        where: () => ({
          returning: () =>
            Promise.resolve([{ id: 'b1', blockerId: 'u1', blockedId: 'u2' }]),
        }),
      });

      await expect(service.unblockUser('u1', 'u2')).resolves.toEqual({
        removed: true,
      });
    });
  });

  describe('listBlocks', () => {
    it('returns [] without a profile query when no blocks exist', async () => {
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({ orderBy: () => Promise.resolve([]) }),
        }),
      });

      await expect(service.listBlocks('u1')).resolves.toEqual([]);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('maps blocked user profiles onto block rows', async () => {
      const createdAt = new Date();
      let callCount = 0;
      db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            from: () => ({
              where: () => ({
                orderBy: () =>
                  Promise.resolve([
                    { id: 'b1', blockerId: 'u1', blockedId: 'u2', createdAt },
                  ]),
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: () =>
              Promise.resolve([
                { id: 'u2', username: 'dara', profilePhotoUrl: null },
              ]),
          }),
        };
      });

      await expect(service.listBlocks('u1')).resolves.toEqual([
        {
          id: 'b1',
          blockedUser: { id: 'u2', username: 'dara', profilePhotoUrl: null },
          createdAt,
        },
      ]);
    });
  });
});

describe('UsersService follows', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;
  let notify: jest.Mock;

  beforeEach(() => {
    db = makeDb();
    notify = jest.fn().mockResolvedValue(undefined);
    service = makeService(db, {}, { notify });
  });

  describe('followUser', () => {
    it('throws BadRequestException when following yourself', async () => {
      await expect(service.followUser('u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
      expect(db.select).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target is missing or soft-deleted', async () => {
      db.select.mockReturnValue(chain([]));

      await expect(service.followUser('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('refuses when either side has blocked the other', async () => {
      db.select
        .mockReturnValueOnce(chain([{ id: 'u2' }])) // target exists
        .mockReturnValueOnce(chain([{ id: 'block-1' }])); // a block exists

      await expect(service.followUser('u1', 'u2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.insert).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('notifies the followed user when the edge is new', async () => {
      db.select
        .mockReturnValueOnce(chain([{ id: 'u2' }]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(
          chain([{ username: 'sokdara', firstName: 'Sok', lastName: 'Dara' }]),
        );
      db.insert.mockReturnValue({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ id: 'f1' }]),
          }),
        }),
      });

      await expect(service.followUser('u1', 'u2')).resolves.toEqual({
        following: true,
      });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u2',
          type: 'follow.created',
          title: 'Sok Dara started following you',
        }),
      );
    });

    it('does not notify again when the edge already existed', async () => {
      db.select
        .mockReturnValueOnce(chain([{ id: 'u2' }]))
        .mockReturnValueOnce(chain([]));
      // The unique pair index swallowed the insert, so nothing came back.
      db.insert.mockReturnValue({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      });

      await expect(service.followUser('u1', 'u2')).resolves.toEqual({
        following: true,
      });
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe('unfollowUser', () => {
    it('resolves rather than 404s when the edge is already gone', async () => {
      db.delete.mockReturnValue({ where: () => Promise.resolve([]) });

      await expect(service.unfollowUser('u1', 'u2')).resolves.toEqual({
        following: false,
      });
    });
  });

  describe('getFollowCounts', () => {
    it('counts followers by following_id and following by follower_id', async () => {
      db.select
        .mockReturnValueOnce(chain([{ value: 3 }]))
        .mockReturnValueOnce(chain([{ value: 5 }]));

      await expect(service.getFollowCounts('u1')).resolves.toEqual({
        followers: 3,
        following: 5,
      });
    });
  });

  describe('listFollowers', () => {
    it('returns the follower side of each edge, in edge order, flagged for the viewer', async () => {
      db.select
        .mockReturnValueOnce(chain([{ userId: 'u2' }, { userId: 'u3' }])) // edges
        .mockReturnValueOnce(chain([{ value: 2 }])) // total
        .mockReturnValueOnce(
          chain([
            {
              id: 'u2',
              username: 'dara',
              firstName: null,
              lastName: null,
              profilePhotoUrl: null,
            },
            {
              id: 'u3',
              username: 'neang',
              firstName: null,
              lastName: null,
              profilePhotoUrl: null,
            },
          ]),
        ) // profiles
        .mockReturnValueOnce(chain([{ id: 'u3' }])); // viewer already follows u3

      const result = await service.listFollowers('u1', 'u9', {});

      expect(result.data.map((u) => [u.username, u.isFollowing])).toEqual([
        ['dara', false],
        ['neang', true],
      ]);
      expect(result.meta).toMatchObject({ total: 2, hasMore: false, page: 1 });
    });

    it('drops a soft-deleted profile from the page', async () => {
      db.select
        .mockReturnValueOnce(chain([{ userId: 'u2' }, { userId: 'gone' }]))
        .mockReturnValueOnce(chain([{ value: 2 }]))
        .mockReturnValueOnce(
          chain([
            {
              id: 'u2',
              username: 'dara',
              firstName: null,
              lastName: null,
              profilePhotoUrl: null,
            },
          ]),
        ) // 'gone' was filtered out by the isNull(deletedAt) predicate
        .mockReturnValueOnce(chain([]));

      const result = await service.listFollowers('u1', 'u9', {});

      expect(result.data).toHaveLength(1);
      expect(result.data[0].username).toBe('dara');
    });
  });
});

describe('UsersService self-service account changes', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;

  beforeEach(() => {
    db = makeDb();
    service = makeService(db, {
      signInWithOtp: jest.fn().mockResolvedValue({ data: {}, error: null }),
      verifyOtp: jest.fn().mockResolvedValue({
        data: { user: { id: 'supabase-id' } },
        error: null,
      }),
    });
  });

  describe('changeUsername', () => {
    it('lowercases the candidate before writing it', async () => {
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      });
      db.update.mockReturnValue({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: () => Promise.resolve([{ ...fakeUser, ...values }]),
          }),
        }),
      });

      const result = await service.changeUsername('u1', {
        username: 'Sok.Dara',
      });

      expect(result.username).toBe('sok.dara');
    });

    it('refuses a username another account already holds', async () => {
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: 'someone-else' }]),
          }),
        }),
      });

      await expect(
        service.changeUsername('u1', { username: 'sokdara' }),
      ).rejects.toThrow(ConflictException);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('maps the check-then-write race onto a 409', async () => {
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      });
      db.update.mockReturnValue({
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.reject(
                Object.assign(new Error('duplicate key'), {
                  code: '23505',
                  constraint_name: 'users_username_active_uq',
                }),
              ),
          }),
        }),
      });

      await expect(
        service.changeUsername('u1', { username: 'sokdara' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('changePassword', () => {
    it('rejects a wrong current password and writes nothing', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([{ id: 'u1', passwordHash: '$2b$10$hash' }]),
          }),
        }),
      });

      await expect(
        service.changePassword('u1', {
          currentPassword: 'wrong-pass',
          newPassword: 'password123',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('refuses an account that has no password yet', async () => {
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: 'u1', passwordHash: null }]),
          }),
        }),
      });

      await expect(
        service.changePassword('u1', {
          currentPassword: 'whatever',
          newPassword: 'password123',
        }),
      ).rejects.toThrow('PASSWORD_NOT_SET');
    });

    it('stores a bcrypt hash of the new password', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$newhash');
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([{ id: 'u1', passwordHash: '$2b$10$hash' }]),
          }),
        }),
      });
      const sets: Record<string, unknown>[] = [];
      db.update.mockImplementation(() => ({
        set: (values: Record<string, unknown>) => {
          sets.push(values);
          return { where: () => Promise.resolve([]) };
        },
      }));

      await service.changePassword('u1', {
        currentPassword: 'password123',
        newPassword: 'password456',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('password456', 10);
      expect(sets).toContainEqual(
        expect.objectContaining({ passwordHash: '$2b$10$newhash' }),
      );
    });
  });

  describe('deleteOwnAccount', () => {
    it('soft-deletes but keeps the phone the recovery window matches on', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([{ id: 'u1', passwordHash: '$2b$10$hash' }]),
          }),
        }),
      });
      const sets: Record<string, unknown>[] = [];
      db.update.mockImplementation(() => ({
        set: (values: Record<string, unknown>) => {
          sets.push(values);
          return { where: () => Promise.resolve([]) };
        },
      }));

      await service.deleteOwnAccount('u1', { password: 'password123' });

      const deletion = sets.find((values) => 'deletedAt' in values);
      expect(deletion).toMatchObject({ status: 'deleted' });
      expect(deletion?.deletedAt).toBeInstanceOf(Date);
      // Nothing may null the identifiers: a null primaryPhone is what marks
      // an ADMIN deletion, and only the sweeper is allowed to remove rows.
      expect(sets).not.toContainEqual(
        expect.objectContaining({ primaryPhone: null }),
      );
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('rejects a wrong password without deactivating anything', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([{ id: 'u1', passwordHash: '$2b$10$hash' }]),
          }),
        }),
      });

      await expect(
        service.deleteOwnAccount('u1', { password: 'wrong-pass' }),
      ).rejects.toThrow(BadRequestException);
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('verifyPhoneChangeOtp', () => {
    it('rejects an invalid OTP without touching the account', async () => {
      const service = makeService(db, {
        verifyOtp: jest.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'invalid' },
        }),
      });

      await expect(
        service.verifyPhoneChangeOtp('u1', {
          phone: '+85512345678',
          token: '999999',
        }),
      ).rejects.toThrow('INVALID_OTP');
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('moves the primary row onto the new number and stamps phoneVerifiedAt', async () => {
      const PHONE = '+85512345678';
      let selectCall = 0;
      db.select.mockImplementation(() => {
        selectCall++;
        // 1: banned-phone lookup, 2: users.primaryPhone owner check, 3:
        // user_phones owner check, 4: the current primary row, 5: findById
        // after the transaction
        const rows =
          selectCall === 4
            ? [{ id: 'p1' }]
            : selectCall === 5
              ? [{ ...fakeUser, primaryPhone: PHONE }]
              : [];
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        };
      });

      const sets: Record<string, unknown>[] = [];
      db.update.mockImplementation(() => ({
        set: (values: Record<string, unknown>) => {
          sets.push(values);
          return { where: () => Promise.resolve([]) };
        },
      }));
      const inserted: Record<string, unknown>[] = [];
      db.insert.mockImplementation(() => ({
        values: (values: Record<string, unknown>) => {
          inserted.push(values);
          return { onConflictDoNothing: () => Promise.resolve([]) };
        },
      }));

      const result = await service.verifyPhoneChangeOtp('u1', {
        phone: PHONE,
        token: '000000',
      });

      expect(result.primaryPhone).toBe(PHONE);
      expect(sets).toContainEqual({ phone: PHONE });
      const verified = sets.find((values) => 'phoneVerifiedAt' in values);
      expect(verified).toMatchObject({ primaryPhone: PHONE });
      expect(verified?.phoneVerifiedAt).toBeInstanceOf(Date);
      expect(inserted).toContainEqual(
        expect.objectContaining({ userId: 'u1', provider: 'phone' }),
      );
    });

    it('refuses a number another account already owns', async () => {
      let selectCall = 0;
      db.select.mockImplementation(() => {
        selectCall++;
        // 1: banned-phone lookup → not banned; 2: phone owner check
        const rows = selectCall === 1 ? [] : [{ id: 'someone-else' }];
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        };
      });

      await expect(
        service.verifyPhoneChangeOtp('u1', {
          phone: '+85512345678',
          token: '000000',
        }),
      ).rejects.toThrow(ConflictException);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });
});

describe('UsersService public profile visibility', () => {
  it('does not expose a moderation-suspended account', async () => {
    let where: unknown;
    const db = makeDb();
    db.select.mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.from = () => c;
      c.where = (arg: unknown) => {
        where = arg;
        return c;
      };
      c.limit = () => Promise.resolve([]);
      return c;
    });
    const service = makeService(db);

    await expect(service.getPublicProfile('sokdara')).rejects.toThrow(
      NotFoundException,
    );

    const { sql } = new PgDialect().sqlToQuery(where as never);
    expect(sql).toContain('"status" = $');
    expect(sql).toContain('"deleted_at" is null');
  });
});

describe('UsersService verified account flag', () => {
  it('marks a public profile with an active paid subscription', async () => {
    const db = makeDb();
    let call = 0;
    db.select.mockImplementation(() => {
      call++;
      // 1: the user row, 2-3: follower/following counts, 4: subscription probe.
      if (call === 1) return chain([fakeUser]);
      if (call === 4) return chain([{ id: 'sub-1' }]);
      return chain([{ value: 0 }]);
    });
    const service = makeService(db);

    const profile = await service.getPublicProfile('sokdara');

    expect(profile.verifiedAccount).toBe(true);
  });

  it('leaves a public profile without a paid subscription unverified', async () => {
    const db = makeDb();
    let call = 0;
    db.select.mockImplementation(() => {
      call++;
      if (call === 1) return chain([fakeUser]);
      if (call === 4) return chain([]);
      return chain([{ value: 0 }]);
    });
    const service = makeService(db);

    const profile = await service.getPublicProfile('sokdara');

    expect(profile.verifiedAccount).toBe(false);
  });

  it('carries the flag on the signed-in user read', async () => {
    const db = makeDb();
    let call = 0;
    db.select.mockImplementation(() => {
      call++;
      const rows: Record<string, unknown>[] =
        call === 1 ? [fakeUser] : [{ id: 'sub-1' }];
      return chain(rows);
    });
    const service = makeService(db);

    const me = await service.findById('u1');

    expect(me.verifiedAccount).toBe(true);
  });

  it('omits linked providers unless the caller opts in', async () => {
    const db = makeDb();
    let call = 0;
    db.select.mockImplementation(() => {
      call++;
      const rows: Record<string, unknown>[] =
        call === 1 ? [fakeUser] : [{ id: 'sub-1' }];
      return chain(rows);
    });
    const service = makeService(db);

    const me = await service.findById('u1');

    expect(me).not.toHaveProperty('authProviders');
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('returns the linked providers in a stable order when requested', async () => {
    const db = makeDb();
    let call = 0;
    db.select.mockImplementation(() => {
      call++;
      const rows: Record<string, unknown>[] =
        call === 1
          ? [fakeUser]
          : call === 2
            ? [{ id: 'sub-1' }]
            : [{ provider: 'telegram' }, { provider: 'google' }];
      return chain(rows);
    });
    const service = makeService(db);

    const me = await service.findById('u1', true);

    expect(me.authProviders).toEqual(['google', 'telegram']);
    expect(db.select).toHaveBeenCalledTimes(3);
  });
});
