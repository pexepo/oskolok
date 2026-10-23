import {describe,it,expect} from 'vitest';
import {inspectUpload,makeZip,reportSchema,sanitizeReportText} from '../server/src/services/userContent.js';
import {normalizeEqualizer} from '../src/audio/equalizer.js';
describe('content validation',()=>{
 it('rejects a renamed executable and empty upload',()=>{expect(()=>inspectUpload('fake.mp3','audio',Buffer.from('MZ executable'))).toThrow();expect(()=>inspectUpload('empty.mp3','audio',Buffer.alloc(0))).toThrow();});
 it('accepts audio headers and rejects mismatched image extension',()=>{expect(inspectUpload('track.flac','audio',Buffer.from('fLaCdata'))).toBe('audio/flac');expect(()=>inspectUpload('screen.png','attachment',Buffer.from('<html>'))).toThrow();});
 it('requires correction context and a matching proposal',()=>{expect(reportSchema.safeParse({requestId:crypto.randomUUID(),kind:'source',reason:'source',description:'Wrong recording'}).success).toBe(false);});
 it('redacts common credentials in diagnostic text',()=>{expect(sanitizeReportText('token=abc secret=qwe Authorization: Bearer xyz')).not.toContain('abc');expect(sanitizeReportText('token=abc secret=qwe Authorization: Bearer xyz')).not.toContain('xyz');});
 it('writes a ZIP with UTF-8 names and matching directory offset',()=>{const zip=makeZip([{name:'01 песня.mp3',data:Buffer.from('audio')}]);expect(zip.readUInt32LE()).toBe(0x04034b50);const end=zip.length-22;expect(zip.readUInt32LE(end)).toBe(0x06054b50);expect(zip.readUInt16LE(end+10)).toBe(1);expect(zip.readUInt32LE(zip.readUInt32LE(end+16))).toBe(0x02014b50);});
 it('bounds equalizer gains and rejects non-finite saved values',()=>{expect(normalizeEqualizer([99,-99,NaN,Infinity,2])).toEqual([12,-12,0,0,2,0,0,0,0,0]);});
});
