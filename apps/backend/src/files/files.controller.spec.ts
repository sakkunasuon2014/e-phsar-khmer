import { ForbiddenException } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

function setup() {
  const real = new FilesService(
    {} as never,
    { get: () => 'listings' } as never,
  );
  const files = {
    getDefaultBucket: () => 'listings',
    isOwnedPath: (path: string, userId: string) =>
      real.isOwnedPath(path, userId),
    remove: jest.fn().mockResolvedValue(undefined),
    createSignedUploadUrl: jest.fn().mockResolvedValue({}),
  };
  return { controller: new FilesController(files as never), files };
}

const user = { id: 'u1', role: 'user' as const };
const admin = { id: 'a1', role: 'admin' as const };

describe('FilesController', () => {
  it('signs user scopes into the caller’s own folder', async () => {
    const { controller, files } = setup();
    await controller.getSignedUploadUrl(user, {
      filename: 'a.png',
      scope: 'listing',
    });
    expect(files.createSignedUploadUrl).toHaveBeenCalledWith(
      'listings',
      'listing/u1',
      'a.png',
    );
  });

  it('refuses catalog uploads from non-staff', () => {
    const { controller } = setup();
    expect(() =>
      controller.getSignedUploadUrl(user, {
        filename: 'a.png',
        scope: 'brand',
      }),
    ).toThrow(ForbiddenException);
  });

  it('signs catalog uploads into the shared folder for staff', async () => {
    const { controller, files } = setup();
    await controller.getSignedUploadUrl(admin, {
      filename: 'a.png',
      scope: 'brand',
    });
    expect(files.createSignedUploadUrl).toHaveBeenCalledWith(
      'listings',
      'brand',
      'a.png',
    );
  });

  it.each([
    ['another user’s listing photo', 'listing/u2/x.png'],
    ['a flat legacy path', 'listing/x.png'],
    ['a catalog image', 'brand/x.png'],
    ['a traversal out of the own folder', 'listing/u1/../u2/x.png'],
  ])('refuses a user deleting %s', (_label, path) => {
    const { controller, files } = setup();
    expect(() => controller.deleteFiles(user, { paths: [path] })).toThrow(
      ForbiddenException,
    );
    expect(files.remove).not.toHaveBeenCalled();
  });

  it('lets a user delete their own objects', async () => {
    const { controller, files } = setup();
    await controller.deleteFiles(user, {
      paths: ['listing/u1/a.png', 'chat/u1/b.png'],
    });
    expect(files.remove).toHaveBeenCalled();
  });

  it('lets staff delete catalog images', async () => {
    const { controller, files } = setup();
    await controller.deleteFiles(admin, { paths: ['brand/x.png'] });
    expect(files.remove).toHaveBeenCalledWith('listings', ['brand/x.png']);
  });
});
