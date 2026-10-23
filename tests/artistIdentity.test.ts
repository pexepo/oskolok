import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/src/services/OfficialCatalogService.js', () => ({ officialCatalogService: {} }));
vi.mock('../server/src/services/SoundCloudService.js', () => ({ soundCloudService: {} }));
import { titleKey, titleOverlap } from '../server/src/services/artistIdentity.js';

describe('artist identity by discography', () => {
  it('reduces titles to what survives between catalogues', () => {
    expect(titleKey('Корми демонов по расписанию (Deluxe)')).toBe(titleKey('корми демонов по расписанию'));
    expect(titleKey('Ёлка — Remastered')).toBe(titleKey('Елка Remastered'));
  });

  it('joins profiles that share a title and keeps namesakes apart', () => {
    const rapper = ['mea maxima culpa', 'Геометрия тьмы', 'Моя милая пустота'];
    expect(titleOverlap(rapper, ['Геометрия тьмы (Deluxe)', 'Другое'])).toBe(1);
    expect(titleOverlap(rapper, ['PROTECT UR KNECK', 'LITHE', 'Sulphur'])).toBe(0);
  });
});
