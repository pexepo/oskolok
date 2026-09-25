import {describe,it,expect} from 'vitest';
import {parseImportList} from '../src/utils/importList.js';
describe('Playlist file import',()=>{
 it('accepts Spotify CSV quoted commas, BOM and escaped quotes',()=>{
  expect(parseImportList('\uFEFFTrack Name,Artist Name(s)\n"Hello, world","Artist"\n"Say ""yes""",Guest')).toEqual([{artist:'Artist',title:'Hello, world'},{artist:'Guest',title:'Say "yes"'}]);
 });
 it('supports Russian headers and deduplicates without dropping different artists',()=>{
  expect(parseImportList('Исполнитель;Название\nА;Трек\nА;Трек\nБ;Трек')).toHaveLength(2);
 });
 it('supports plain lists and rejects unreadable or oversized imports',()=>{
  expect(parseImportList('Artist — Song\nGuest - Other')).toHaveLength(2);
  expect(()=>parseImportList('unstructured')).toThrow();
  expect(()=>parseImportList('a'.repeat(1000001))).toThrow();
 });
});
