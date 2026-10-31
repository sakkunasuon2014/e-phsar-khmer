import { NotFoundException } from '@nestjs/common';
import { AdvertisementsService } from './advertisements.service';
import type { AdvertisementRow } from '../db/schema/advertisements.schema';

const ACTOR = '22222222-2222-4222-8222-222222222222';

function row(overrides: Partial<AdvertisementRow> = {}): AdvertisementRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    placement: 'home',
    imagePath: 'advertisement/aaa-flag.gif',
    linkUrl: null,
    altText: '',
    sortOrder: 0,
    isActive: true,
    createdById: ACTOR,
    createdAt: new Date('2026-10-26T00:00:00Z'),
    updatedAt: new Date('2026-10-26T00:00:00Z'),
    ...overrides,
  };
}

type Chain = {
  from: jest.Mock;
  where: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
};

/**
 * One fake db covering every call shape the service uses. `select` resolves to
 * `options.existing` (a row, an empty list, or a list of rows), so a single
 * helper serves the storefront read, the admin read and update's pre-read.
 */
function makeDb(
  options: { existing?: AdvertisementRow[]; updateRow?: AdvertisementRow } = {},
) {
  const existing = options.existing ?? [];
  const chain: Chain = {
    from: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
  };
  // `.from()` returns the same object so `.where/.orderBy/.limit` chain freely.
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockImplementation(() => Promise.resolve(existing));
  chain.limit.mockImplementation(() => Promise.resolve(existing));

  const values = jest.fn();
  const set = jest.fn();
  const db = {
    select: jest.fn(() => chain),
    insert: jest.fn(() => ({
      values: (v: Record<string, unknown>) => {
        values(v);
        return {
          returning: () =>
            Promise.resolve([
              options.updateRow ?? row(v as Partial<AdvertisementRow>),
            ]),
        };
      },
    })),
    update: jest.fn(() => ({
      set: (v: Record<string, unknown>) => {
        set(v);
        return {
          where: () => ({
            returning: () =>
              Promise.resolve([
                options.updateRow ?? row(v as Partial<AdvertisementRow>),
              ]),
          }),
        };
      },
    })),
    delete: jest.fn(() => ({
      where: () => ({
        returning: () => Promise.resolve(existing.length ? [existing[0]] : []),
      }),
    })),
  };
  return { db, chain, values, set };
}

function makeFiles() {
  return {
    getDefaultBucket: jest.fn().mockReturnValue('listings'),
    remove: jest.fn().mockResolvedValue(undefined),
    publicUrlFor: jest.fn((path: string) => `https://cdn.example/${path}`),
  };
}

describe('AdvertisementsService', () => {
  it('resolves storefront banners to public URLs without leaking storage paths', async () => {
    const { db } = makeDb({ existing: [row()] });
    const files = makeFiles();
    const service = new AdvertisementsService(db as never, files as never);

    const [banner] = await service.listActive('home');

    expect(banner.imageUrl).toBe(
      'https://cdn.example/advertisement/aaa-flag.gif',
    );
    expect(banner).not.toHaveProperty('imagePath');
    expect(banner).not.toHaveProperty('isActive');
    expect(files.publicUrlFor).toHaveBeenCalledWith(
      'advertisement/aaa-flag.gif',
    );
  });

  it('orders storefront banners by sort order then creation, oldest first', async () => {
    const { db, chain } = makeDb({ existing: [] });
    const service = new AdvertisementsService(
      db as never,
      makeFiles() as never,
    );

    await service.listActive('home');

    expect(chain.orderBy).toHaveBeenCalledTimes(1);
    expect(chain.orderBy.mock.calls[0]).toHaveLength(3);
  });

  it('defaults a new banner to active, unsorted and linkless', async () => {
    const { db, values } = makeDb();
    const service = new AdvertisementsService(
      db as never,
      makeFiles() as never,
    );

    await service.create(
      {
        placement: 'all_ads',
        imagePath: 'advertisement/bbb.jpg',
        linkUrl: '   ',
      },
      ACTOR,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: 'all_ads',
        imagePath: 'advertisement/bbb.jpg',
        linkUrl: null,
        altText: '',
        sortOrder: 0,
        isActive: true,
        createdById: ACTOR,
      }),
    );
  });

  it('404s an update for a banner that does not exist', async () => {
    const { db } = makeDb({ existing: [] });
    const service = new AdvertisementsService(
      db as never,
      makeFiles() as never,
    );

    await expect(service.update('missing', { sortOrder: 2 })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('keeps the stored image when the image path is unchanged', async () => {
    const { db } = makeDb({ existing: [row()] });
    const files = makeFiles();
    const service = new AdvertisementsService(db as never, files as never);

    await service.update('33333333-3333-4333-8333-333333333333', {
      imagePath: 'advertisement/aaa-flag.gif',
      isActive: false,
    });

    expect(files.remove).not.toHaveBeenCalled();
  });

  it('deletes the replaced image only after the new path is written', async () => {
    const { db } = makeDb({ existing: [row()] });
    const files = makeFiles();
    const service = new AdvertisementsService(db as never, files as never);

    await service.update('33333333-3333-4333-8333-333333333333', {
      imagePath: 'advertisement/ccc-new.jpg',
    });

    expect(files.remove).toHaveBeenCalledWith('listings', [
      'advertisement/aaa-flag.gif',
    ]);
  });

  it('404s a delete for a banner that does not exist', async () => {
    const { db } = makeDb({ existing: [] });
    const service = new AdvertisementsService(
      db as never,
      makeFiles() as never,
    );

    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });

  it('removes the stored image when a banner is deleted', async () => {
    const { db } = makeDb({ existing: [row()] });
    const files = makeFiles();
    const service = new AdvertisementsService(db as never, files as never);

    await service.remove('33333333-3333-4333-8333-333333333333');

    expect(files.remove).toHaveBeenCalledWith('listings', [
      'advertisement/aaa-flag.gif',
    ]);
  });
});
