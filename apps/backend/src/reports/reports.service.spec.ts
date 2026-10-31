import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserReportsService } from './reports.service';

const limitChain = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
});

function setup(selects: unknown[][], insertResult: Promise<unknown[]>) {
  let call = 0;
  const db = {
    select: jest.fn(() => limitChain(selects[call++] ?? [])),
    insert: jest.fn(() => ({
      values: () => ({ returning: () => insertResult }),
    })),
  };
  const files = {
    isOwnedPath: (p: string, u: string) => p.startsWith(`report/${u}/`),
  };
  return {
    service: new UserReportsService(db as never, files as never),
    db,
  };
}

const dto = { listingId: 'l1', reasonId: 'r1' };

describe('UserReportsService.reportListing', () => {
  it('files a report', async () => {
    const { service } = setup(
      [[{ userId: 'owner', moderatedAt: null }], [{ id: 'r1' }]],
      Promise.resolve([{ id: 'rep1' }]),
    );
    await expect(service.reportListing('me', dto)).resolves.toEqual({
      id: 'rep1',
    });
  });

  it('refuses reporting your own listing', async () => {
    const { service } = setup(
      [[{ userId: 'me', moderatedAt: null }]],
      Promise.resolve([]),
    );
    await expect(service.reportListing('me', dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('404s a removed listing', async () => {
    const { service } = setup(
      [[{ userId: 'owner', moderatedAt: new Date() }]],
      Promise.resolve([]),
    );
    await expect(service.reportListing('me', dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a reason of the wrong target type', async () => {
    const { service } = setup(
      [[{ userId: 'owner', moderatedAt: null }], []],
      Promise.resolve([]),
    );
    await expect(service.reportListing('me', dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('turns a second open report into 409', async () => {
    const { service } = setup(
      [[{ userId: 'owner', moderatedAt: null }], [{ id: 'r1' }]],
      Promise.reject(Object.assign(new Error('duplicate'), { code: '23505' })),
    );
    await expect(service.reportListing('me', dto)).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('UserReportsService.reportUser', () => {
  it('refuses reporting yourself', async () => {
    const { service } = setup([], Promise.resolve([]));
    await expect(
      service.reportUser('me', { targetUserId: 'me', reasonId: 'r1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an image path the reporter does not own', async () => {
    const { service } = setup(
      [[{ id: 'u2' }], [{ id: 'r1' }]],
      Promise.resolve([]),
    );
    await expect(
      service.reportUser('me', {
        targetUserId: 'u2',
        reasonId: 'r1',
        imagePaths: ['report/u2/x.png'],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
