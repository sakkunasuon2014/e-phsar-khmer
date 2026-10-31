import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbClient } from '../db/drizzle.provider';
import { ProductsService } from './products.service';

const dialect = new PgDialect();

/** The select chain used by every joined product read. */
function selectChain(result: unknown[]) {
  const limit = jest.fn().mockResolvedValue(result);
  // `.orderBy()` is the end of `listAdmin`'s chain and the middle of
  // `listPublished`'s — real drizzle returns a thenable that also has
  // `.limit()`, so the mock must be both.
  const orderByResult = Object.assign(Promise.resolve(result), { limit });
  const orderBy = jest.fn(() => orderByResult);
  const where = jest.fn(() => ({ limit, orderBy }));
  const chain: Record<string, jest.Mock> = {
    from: jest.fn(() => chain),
    innerJoin: jest.fn(() => chain),
    where,
    orderBy,
    limit,
  };
  return { chain, where, orderBy, limit };
}

/** `.select().from().where().limit()` — the update existence probe. */
function simpleSelect(result: unknown[]) {
  return {
    from: () => ({ where: () => ({ limit: () => Promise.resolve(result) }) }),
  };
}

function makeDb() {
  return {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

function makeService(db: ReturnType<typeof makeDb>) {
  return new ProductsService(db as unknown as DbClient);
}

const summaryRow = {
  id: 'spec-1',
  modelId: 'm1',
  family: 'phone',
  brandId: 'b1',
  brandSlug: 'apple',
  brandName: 'Apple',
  modelSlug: 'iphone-16',
  modelName: 'iPhone 16',
  image: null,
};

const detailRow = {
  ...summaryRow,
  specGroups: [{ title: 'Display', rows: [{ label: 'Size', value: '6.1"' }] }],
  isPublished: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProductsService public reads', () => {
  it('lists published products with the caller limit', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain, orderBy, limit } = selectChain([summaryRow]);
    db.select.mockReturnValue(chain);

    const rows = await service.listPublished({ limit: 6 });

    expect(rows).toEqual([summaryRow]);
    expect(orderBy).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(6);
  });

  it('searches every token across brand and model names/slugs', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain, where } = selectChain([]);
    db.select.mockReturnValue(chain);

    await service.listPublished({ q: 'iphone 18', limit: 5 });

    const compiled = dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
    expect(compiled.sql).toContain('"is_published"');
    expect(compiled.sql).toContain('is_active');
    expect(compiled.sql.match(/ilike/gi)?.length).toBe(8);
    expect(compiled.params).toEqual(
      expect.arrayContaining(['%iphone%', '%18%']),
    );
  });

  it('escapes wildcard characters in the search term', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain, where } = selectChain([]);
    db.select.mockReturnValue(chain);

    await service.listPublished({ q: '100%', limit: 5 });

    const compiled = dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
    expect(compiled.params).toContain('%100\\%%');
  });

  it('returns a published page by brand/model slug', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain } = selectChain([detailRow]);
    db.select.mockReturnValue(chain);

    await expect(
      service.getPublishedBySlug('apple', 'iphone-16'),
    ).resolves.toEqual(detailRow);
  });

  it('404s a missing or unpublished page', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain } = selectChain([]);
    db.select.mockReturnValue(chain);

    await expect(
      service.getPublishedBySlug('apple', 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists every spec page for the admin table', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain, orderBy } = selectChain([detailRow]);
    db.select.mockReturnValue(chain);

    await expect(service.listAdmin()).resolves.toEqual([detailRow]);
    expect(orderBy).toHaveBeenCalled();
  });
});

describe('ProductsService listing gate', () => {
  it('resolves when the model has a published page', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain } = selectChain([{ id: 'spec-1' }]);
    db.select.mockReturnValue(chain);

    await expect(service.assertPublishedModel('m1')).resolves.toBeUndefined();
  });

  it('rejects a model without a published page', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain } = selectChain([]);
    db.select.mockReturnValue(chain);

    await expect(service.assertPublishedModel('m1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a spec whose family differs from the listing subcategory', async () => {
    const db = makeDb();
    const service = makeService(db);
    // 1) the published-spec probe returns a phone-family row
    db.select.mockReturnValueOnce(
      selectChain([{ id: 'p1', family: 'phone' }]).chain,
    );
    // 2) the subcategory probe returns cars-for-sale
    db.select.mockReturnValueOnce(simpleSelect([{ slug: 'cars-for-sale' }]));

    await expect(service.assertPublishedModel('m1', 'sub-car')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('skips the family check for a subcategory with no family', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select.mockReturnValueOnce(
      selectChain([{ id: 'p1', family: 'phone' }]).chain,
    );
    db.select.mockReturnValueOnce(simpleSelect([{ slug: 'laptops' }]));

    await expect(
      service.assertPublishedModel('m1', 'sub-laptop'),
    ).resolves.toBeUndefined();
  });

  it('maps a published ref for the listing detail', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain } = selectChain([
      {
        modelId: 'm1',
        brandSlug: 'apple',
        brandName: 'Apple',
        modelSlug: 'iphone-16',
        modelName: 'iPhone 16',
      },
    ]);
    db.select.mockReturnValue(chain);

    await expect(service.getPublishedRefByModelId('m1')).resolves.toEqual({
      modelId: 'm1',
      brandSlug: 'apple',
      brandName: 'Apple',
      modelSlug: 'iphone-16',
      modelName: 'iPhone 16',
    });
  });

  it('returns null when the page is gone', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain } = selectChain([]);
    db.select.mockReturnValue(chain);

    await expect(service.getPublishedRefByModelId('m1')).resolves.toBeNull();
  });
});

describe('ProductsService admin writes', () => {
  it('creates a spec page with trimmed groups and published by default', async () => {
    const db = makeDb();
    const service = makeService(db);
    const values = jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([{ id: 'spec-1' }]),
    }));
    db.insert.mockReturnValue({ values });
    db.select
      .mockReturnValueOnce(selectChain([{ modelId: 'm1' }]).chain)
      .mockReturnValueOnce(selectChain([detailRow]).chain);

    await service.createAdmin({
      modelId: 'm1',
      family: 'phone',
      specGroups: [
        {
          title: '  Display  ',
          rows: [{ label: ' Size ', value: ' 6.1" ' }],
        },
      ],
    });

    expect(values).toHaveBeenCalledWith({
      modelId: 'm1',
      family: 'phone',
      image: null,
      specGroups: [
        { title: 'Display', rows: [{ label: 'Size', value: '6.1"' }] },
      ],
      isPublished: true,
    });
  });

  it('rejects empty spec text', async () => {
    const db = makeDb();
    const service = makeService(db);

    await expect(
      service.createAdmin({
        modelId: 'm1',
        family: 'phone',
        specGroups: [
          { title: 'Display', rows: [{ label: ' ', value: '6.1"' }] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('maps a duplicate model to 409', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select.mockReturnValueOnce(selectChain([{ modelId: 'm1' }]).chain);
    db.insert.mockReturnValue({
      values: () => ({
        returning: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('dup'), { code: '23505' }),
          ),
      }),
    });

    await expect(
      service.createAdmin({
        modelId: 'm1',
        family: 'phone',
        specGroups: [
          { title: 'Battery', rows: [{ label: 'Type', value: 'Li-Ion' }] },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a missing model to 400', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select.mockReturnValueOnce(selectChain([{ modelId: 'm1' }]).chain);
    db.insert.mockReturnValue({
      values: () => ({
        returning: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error('fk'), { code: '23503' })),
      }),
    });

    await expect(
      service.createAdmin({
        modelId: 'm1',
        family: 'phone',
        specGroups: [
          { title: 'Battery', rows: [{ label: 'Type', value: 'Li-Ion' }] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an update on a missing page', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select.mockReturnValue(simpleSelect([]));

    await expect(
      service.updateAdmin('spec-1', { isPublished: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates groups and publish state', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select
      .mockReturnValueOnce(
        simpleSelect([{ id: 'spec-1', family: 'phone', specGroups: [] }]),
      )
      .mockReturnValueOnce(selectChain([detailRow]).chain);
    const set = jest.fn(() => ({ where: jest.fn() }));
    db.update.mockReturnValue({ set });

    await service.updateAdmin('spec-1', {
      specGroups: [
        { title: 'Battery', rows: [{ label: 'Type', value: 'Li-Ion' }] },
      ],
      isPublished: false,
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ isPublished: false }),
    );
  });

  it('404s a delete on a missing page', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.delete.mockReturnValue({
      where: () => ({ returning: jest.fn().mockResolvedValue([]) }),
    });

    await expect(service.removeAdmin('spec-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes the page', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.delete.mockReturnValue({
      where: () => ({
        returning: jest.fn().mockResolvedValue([{ id: 'spec-1' }]),
      }),
    });

    await expect(service.removeAdmin('spec-1')).resolves.toEqual({
      id: 'spec-1',
    });
  });
});

describe('ProductsService families', () => {
  it('rejects a model that is not linked to the family subcategory', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select.mockReturnValueOnce(selectChain([]).chain); // link probe: no row

    await expect(
      service.createAdmin({
        modelId: 'm1',
        family: 'car',
        specGroups: [
          { title: 'Overview', rows: [{ label: 'Years', value: '2026' }] },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects a group outside the family template on create', async () => {
    const db = makeDb();
    const service = makeService(db);

    // Validation runs before any DB read, so no select mock is needed.
    await expect(
      service.createAdmin({
        modelId: 'm1',
        family: 'phone',
        specGroups: [
          { title: 'Engine', rows: [{ label: 'Displacement', value: '2.0' }] },
        ],
      }),
    ).rejects.toThrow('INVALID_SPEC_SECTION');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('accepts repeated labels for a multi-value template field on create', async () => {
    const db = makeDb();
    const service = makeService(db);
    const values = jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([{ id: 'spec-1' }]),
    }));
    db.insert.mockReturnValue({ values });
    db.select
      .mockReturnValueOnce(selectChain([{ modelId: 'm1' }]).chain)
      .mockReturnValueOnce(
        selectChain([{ ...detailRow, family: 'phone', specGroups: [] }]).chain,
      );

    const specGroups = [
      {
        title: 'Network',
        rows: [
          { label: '4G bands', value: '1, 2, 3, 4 - A3296' },
          { label: '4G bands', value: '1, 2, 3, 4, 5 - A3084' },
        ],
      },
    ];

    await service.createAdmin({ modelId: 'm1', family: 'phone', specGroups });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ family: 'phone', specGroups }),
    );
  });

  it('accepts arbitrary groups for a freeform family on create', async () => {
    const db = makeDb();
    const service = makeService(db);
    const values = jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([{ id: 'spec-1' }]),
    }));
    db.insert.mockReturnValue({ values });
    db.select
      .mockReturnValueOnce(selectChain([{ modelId: 'm1' }]).chain)
      .mockReturnValueOnce(
        selectChain([{ ...detailRow, family: 'car', specGroups: [] }]).chain,
      );

    await service.createAdmin({
      modelId: 'm1',
      family: 'car',
      specGroups: [
        { title: 'Engine', rows: [{ label: 'Displacement', value: '1.3L' }] },
        { title: 'Battery', rows: [{ label: 'Capacity', value: '45.12 kWh' }] },
      ],
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        family: 'car',
        specGroups: [
          { title: 'Engine', rows: [{ label: 'Displacement', value: '1.3L' }] },
          {
            title: 'Battery',
            rows: [{ label: 'Capacity', value: '45.12 kWh' }],
          },
        ],
      }),
    );
  });

  it('accepts arbitrary groups for a freeform family on update', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select
      .mockReturnValueOnce(
        simpleSelect([{ id: 'p1', family: 'car', specGroups: [] }]),
      )
      .mockReturnValueOnce(
        selectChain([{ ...detailRow, family: 'car', specGroups: [] }]).chain,
      );
    const set = jest.fn(() => ({ where: jest.fn() }));
    db.update.mockReturnValue({ set });

    await expect(
      service.updateAdmin('p1', {
        specGroups: [
          {
            title: 'Engine',
            rows: [{ label: 'Displacement', value: '1.3L' }],
          },
        ],
      }),
    ).resolves.toBeDefined();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        specGroups: [
          { title: 'Engine', rows: [{ label: 'Displacement', value: '1.3L' }] },
        ],
      }),
    );
  });

  it('keeps a legacy group that is already stored on the row', async () => {
    const db = makeDb();
    const service = makeService(db);
    const legacy = {
      title: 'Display',
      rows: [{ label: 'Panel', value: 'OLED' }],
    };
    db.select
      .mockReturnValueOnce(
        simpleSelect([{ id: 'p1', family: 'phone', specGroups: [legacy] }]),
      )
      .mockReturnValueOnce(
        selectChain([{ ...detailRow, family: 'phone', specGroups: [legacy] }])
          .chain,
      );
    db.update.mockReturnValue({
      set: () => ({ where: () => Promise.resolve([]) }),
    });

    await expect(
      service.updateAdmin('p1', { specGroups: [legacy] }),
    ).resolves.toMatchObject({ specGroups: [legacy] });
  });

  it('rejects a new non-template group on update', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select.mockReturnValueOnce(
      simpleSelect([{ id: 'p1', family: 'phone', specGroups: [] }]),
    );

    await expect(
      service.updateAdmin('p1', {
        specGroups: [
          { title: 'Display', rows: [{ label: 'Panel', value: 'OLED' }] },
        ],
      }),
    ).rejects.toThrow('INVALID_SPEC_SECTION');
  });

  it('filters the public list by family', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain, where } = selectChain([]);
    db.select.mockReturnValue(chain);

    await service.listPublished({ family: 'car' });

    const compiled = dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
    expect(compiled.sql).toContain('"family"');
    expect(compiled.params).toContain('car');
  });

  it('filters the admin list by family', async () => {
    const db = makeDb();
    const service = makeService(db);
    const { chain, where } = selectChain([detailRow]);
    db.select.mockReturnValue(chain);

    await service.listAdmin('phone');

    const compiled = dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
    expect(compiled.sql).toContain('"family"');
    expect(compiled.params).toContain('phone');
  });
});

describe('ProductsService images', () => {
  const imageUrl =
    'https://example.supabase.co/storage/v1/object/public/product-images/product/a.png';

  it('stores a product image URL on create', async () => {
    const db = makeDb();
    const service = makeService(db);
    const values = jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([{ id: 'spec-1' }]),
    }));
    db.insert.mockReturnValue({ values });
    db.select
      .mockReturnValueOnce(selectChain([{ modelId: 'm1' }]).chain)
      .mockReturnValueOnce(selectChain([detailRow]).chain);

    await service.createAdmin({
      modelId: 'm1',
      family: 'car',
      image: imageUrl,
      specGroups: [
        { title: 'Engine', rows: [{ label: 'Displacement', value: '1.3L' }] },
      ],
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ image: imageUrl }),
    );
  });

  it('clears the image when an empty string is sent', async () => {
    const db = makeDb();
    const service = makeService(db);
    db.select
      .mockReturnValueOnce(
        simpleSelect([{ id: 'p1', family: 'car', specGroups: [] }]),
      )
      .mockReturnValueOnce(selectChain([detailRow]).chain);
    const set = jest.fn(() => ({ where: jest.fn() }));
    db.update.mockReturnValue({ set });

    await service.updateAdmin('p1', { image: '' });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ image: null }));
  });
});
