import { NotFoundException } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import type { CreateFeedbackDto } from './dto/feedback.dto';

const USER = '11111111-1111-4111-8111-111111111111';

type MockFiles = {
  getDefaultBucket: jest.Mock;
  uploadPublic: jest.Mock;
  remove: jest.Mock;
  publicUrlFor: jest.Mock;
};

type MockDb = {
  select: jest.Mock;
  insert: jest.Mock;
  delete: jest.Mock;
};

function makeFiles(): MockFiles {
  return {
    getDefaultBucket: jest.fn().mockReturnValue('listings'),
    uploadPublic: jest.fn(
      (_bucket: string, prefix: string, file: Express.Multer.File) =>
        Promise.resolve({ path: `${prefix}/${file.originalname}` }),
    ),
    remove: jest.fn().mockResolvedValue(undefined),
    publicUrlFor: jest.fn((path: string) => `https://cdn.example/${path}`),
  };
}

function makeDb(
  options: {
    activeUser?: string | null;
    insertError?: Error;
    removedRow?: { imagePaths: string[] } | undefined;
  } = {},
): { db: MockDb; sink: { values?: Record<string, unknown> } } {
  const sink: { values?: Record<string, unknown> } = {};
  const db: MockDb = {
    select: jest.fn(() => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              options.activeUser ? [{ id: options.activeUser }] : [],
            ),
        }),
      }),
    })),
    insert: jest.fn(() => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          if (options.insertError) return Promise.reject(options.insertError);
          sink.values = values;
          return Promise.resolve([{ id: 'fb-1' }]);
        },
      }),
    })),
    delete: jest.fn(() => ({
      where: () => ({
        returning: () =>
          Promise.resolve(options.removedRow ? [options.removedRow] : []),
      }),
    })),
  };
  return { db, sink };
}

function image(name: string): Express.Multer.File {
  return { originalname: name } as Express.Multer.File;
}

function dto(overrides: Partial<CreateFeedbackDto> = {}): CreateFeedbackDto {
  return {
    name: 'Sok Dara',
    phone: '+855969990201',
    description: 'The feed is great',
    ...overrides,
  };
}

describe('FeedbackService', () => {
  it('inserts a trimmed row for an anonymous submitter', async () => {
    const { db, sink } = makeDb();
    const files = makeFiles();
    const service = new FeedbackService(db as never, files as never);

    const result = await service.create(
      dto({ name: '  Sok Dara  ', description: '  Great app  ' }),
      [],
      null,
    );

    expect(result).toEqual({ id: 'fb-1' });
    expect(sink.values).toEqual(
      expect.objectContaining({
        userId: null,
        name: 'Sok Dara',
        phone: '+855969990201',
        description: 'Great app',
        imagePaths: [],
      }),
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it('stamps the account id when the submission belongs to an active account', async () => {
    const { db, sink } = makeDb({ activeUser: USER });
    const service = new FeedbackService(db as never, makeFiles() as never);

    await service.create(dto(), [], USER);

    expect(sink.values?.userId).toBe(USER);
  });

  it('degrades to anonymous when the token account is gone', async () => {
    const { db, sink } = makeDb({ activeUser: null });
    const service = new FeedbackService(db as never, makeFiles() as never);

    await service.create(dto(), [], USER);

    expect(sink.values?.userId).toBeNull();
  });

  it('drops an empty email rather than storing an empty string', async () => {
    const { db, sink } = makeDb();
    const service = new FeedbackService(db as never, makeFiles() as never);

    await service.create(dto({ email: '   ' }), [], null);

    expect(sink.values?.email).toBeNull();
  });

  it('uploads images under the feedback/ folder and stores their paths', async () => {
    const { db, sink } = makeDb();
    const files = makeFiles();
    const service = new FeedbackService(db as never, files as never);

    await service.create(dto(), [image('a.webp'), image('b.webp')], null);

    expect(files.uploadPublic).toHaveBeenCalledTimes(2);
    expect(files.uploadPublic).toHaveBeenCalledWith(
      'listings',
      'feedback',
      expect.anything(),
    );
    expect(sink.values?.imagePaths).toEqual([
      'feedback/a.webp',
      'feedback/b.webp',
    ]);
  });

  it('caps uploads at FEEDBACK_MAX_IMAGES (6)', async () => {
    const { db } = makeDb();
    const files = makeFiles();
    const service = new FeedbackService(db as never, files as never);

    await service.create(
      dto(),
      Array.from({ length: 8 }, (_, i) => image(`${i}.webp`)),
      null,
    );

    expect(files.uploadPublic).toHaveBeenCalledTimes(6);
  });

  it('removes already-uploaded images when the insert fails', async () => {
    const failure = new Error('insert failed');
    const { db } = makeDb({ insertError: failure });
    const files = makeFiles();
    const service = new FeedbackService(db as never, files as never);

    await expect(service.create(dto(), [image('a.webp')], null)).rejects.toBe(
      failure,
    );
    expect(files.remove).toHaveBeenCalledWith('listings', ['feedback/a.webp']);
  });

  it('deletes a row and cleans up its images', async () => {
    const { db } = makeDb({ removedRow: { imagePaths: ['feedback/a.webp'] } });
    const files = makeFiles();
    const service = new FeedbackService(db as never, files as never);

    await expect(service.remove('fb-1')).resolves.toEqual({ id: 'fb-1' });
    expect(files.remove).toHaveBeenCalledWith('listings', ['feedback/a.webp']);
  });

  it('404s when the row is already gone', async () => {
    const { db } = makeDb({ removedRow: undefined });
    const service = new FeedbackService(db as never, makeFiles() as never);

    await expect(service.remove('fb-1')).rejects.toThrow(NotFoundException);
  });
});
