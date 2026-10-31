import { AttributesService } from './attributes.service';
import type { DbClient } from '../db/drizzle.provider';
import type { FilesService } from '../files/files.service';

/**
 * Regression: editing a body type with an empty Khmer name 500'd —
 * `AttributesService.update` called `.trim()` on a null `nameKm`. The web
 * action sends `input.nameKm || null`, and @IsOptional lets null through, so
 * the service must treat null as "clear the Khmer name".
 */
describe('AttributesService.update', () => {
  function build() {
    const returning = jest
      .fn()
      .mockResolvedValue([{ id: 'attr-1', nameKm: null }]);
    const set = jest.fn(() => ({
      where: jest.fn(() => ({ returning })),
    }));
    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([{ image: null }]),
          })),
        })),
      })),
      update: jest.fn(() => ({ set })),
    };
    const files = { removeByPublicUrl: jest.fn() };
    const service = new AttributesService(
      db as unknown as DbClient,
      files as unknown as FilesService,
    );
    return { service, set };
  }

  it('accepts nameKm: null and clears the Khmer name', async () => {
    const { service, set } = build();

    await expect(
      service.update('bodytypes', 'attr-1', { nameKm: null }),
    ).resolves.toEqual({ id: 'attr-1', nameKm: null });

    expect(set).toHaveBeenCalledWith({ nameKm: null });
  });

  it('still trims a real Khmer name', async () => {
    const { service, set } = build();

    await service.update('bodytypes', 'attr-1', { nameKm: '  សេដាន  ' });

    expect(set).toHaveBeenCalledWith({ nameKm: 'សេដាន' });
  });
});
