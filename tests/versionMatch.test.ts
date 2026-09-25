import { describe, it, expect } from 'vitest';
import { hasVersion } from '../server/src/utils/versionMatch.js';
describe('recording edition boundaries', () => {
 it('does not permit live recordings for Believer', () => {
   expect(hasVersion('Believer Imagine Dragons', 'live')).toBe(false);
   expect(hasVersion('Believer (Live at Wembley)', 'live')).toBe(true);
 });
 it('matches editions across punctuation and Cyrillic', () => {
   expect(hasVersion('Believer — Sped-Up', 'sped up')).toBe(true);
   expect(hasVersion('Песня (РЕМИКС)', 'ремикс')).toBe(true);
   expect(hasVersion('Discover', 'cover')).toBe(false);
 });
});
