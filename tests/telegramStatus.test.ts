import {describe,expect,it,vi} from 'vitest';
vi.mock('../server/src/database/client.js',()=>({prisma:{}}));
vi.mock('../server/src/controllers/trackController.js',()=>({trackController:{}}));
vi.mock('../server/src/services/StudioMasterService.js',()=>({studioMasterService:{}}));
vi.mock('../server/src/services/telegramNowPlaying.js',()=>({profileMusicThumbnail:vi.fn()}));
vi.mock('../server/src/repositories/likedRepository.js',()=>({likedRepository:{}}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:vi.fn(),info:vi.fn()}}));
import * as server from '../server/src/services/telegramStatus.js';
import * as client from '../src/telegram/statusTemplate.js';
import {hashQueue,queueWindow} from '../src/telegram/playbackQueue.js';
import {compactTrack,windowQueue} from '../server/src/services/telegramPlayback.js';

const long='A'.repeat(300);
describe('Telegram status styles',()=>{
  it('ships about a dozen styles with the fixed text and the default first',()=>{
    expect(server.STATUS_STYLES.length).toBeGreaterThanOrEqual(10);
    expect(server.STATUS_STYLES[0].id).toBe(server.STATUS_DEFAULT);
    expect(server.renderStatusTitle(null,{title:'даря себя огню'})).toBe('Слушает в @oskolokplayerbot - даря себя огню');
    for(const s of server.STATUS_STYLES)expect(server.renderStatusTitle(s.id,{title:'x'})).toContain('Слушает в @');
  });
  it('client and server render identically',()=>{
    expect(client.STATUS_STYLES).toEqual(server.STATUS_STYLES);
    for(const s of server.STATUS_STYLES)for(const title of ['Kino — Gruppa krovi 1988','даря себя огню',long,''])
      expect(client.renderStatusTitle(s.id,{title})).toBe(server.renderStatusTitle(s.id,{title}));
  });
  it('styles only Latin letters and digits, Cyrillic stays readable',()=>{
    expect(server.stylize('Abc 1 Ж','bold')).toBe('𝐀𝐛𝐜 𝟏 Ж');
    expect(server.stylize('Hi','double')).toBe('ℍ𝕚');
    expect(server.stylize('oskolok','smallcaps')).toBe('ᴏꜱᴋᴏʟᴏᴋ');
    expect(server.stylize('mono 7','mono')).toBe('𝚖𝚘𝚗𝚘 𝟽');
    expect(server.renderStatusTitle('bold',{title:'Трек'})).toContain('Слушает в @𝐨𝐬𝐤𝐨𝐥𝐨𝐤𝐩𝐥𝐚𝐲𝐞𝐫𝐛𝐨𝐭 - Трек');
  });
  it('fits 128 UTF-16 units by truncating only the track title, never splitting surrogate pairs',()=>{
    for(const s of server.STATUS_STYLES){
      const out=server.renderStatusTitle(s.id,{title:long});
      expect(out.length).toBeLessThanOrEqual(128);
      expect(out.startsWith(server.stylize(s.prefix+server.STATUS_FIXED,s.font))).toBe(true);
      expect(out.endsWith('…'+s.suffix)).toBe(true);
      expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(out)).toBe(false);
    }
  });
  it('accepts only known style ids and maps the default to null',()=>{
    expect(server.validateStatusTemplate('classic')).toBe(null);
    expect(server.validateStatusTemplate(null)).toBe(null);
    expect(server.validateStatusTemplate('kagi')).toBe('kagi');
    expect(()=>server.validateStatusTemplate('{artist} · {track}')).toThrow(/готовых стилей/);
    expect(()=>server.validateStatusTemplate(42)).toThrow();
    expect(server.statusStyle('Слушаю {track}').id).toBe('classic');
  });
});

describe('playback queue sync',()=>{
  it('client and server cut the same window around the current track',()=>{
    const queue=Array.from({length:1000},(_,i)=>({id:`t${i}`}));
    for(const index of [0,10,500,990]){
      const c=queueWindow(queue,index),s=windowQueue(queue as never,index);
      expect(c.tracks.length).toBe(300);expect(c.tracks[c.index]).toBe(queue[index]);
      expect(s.queue).toEqual(c.tracks);expect(s.index).toBe(c.index);
    }
  });
  it('hashes by ids and order',()=>{
    expect(hashQueue([{id:'a'},{id:'b'}])).toBe(hashQueue([{id:'a'},{id:'b'}]));
    expect(hashQueue([{id:'a'},{id:'b'}])).not.toBe(hashQueue([{id:'b'},{id:'a'}]));
    expect(hashQueue([{id:'ab'}])).not.toBe(hashQueue([{id:'a'},{id:'b'}]));
  });
  it('stores compact track snapshots and rejects junk',()=>{
    expect(compactTrack({id:'x',title:'T',artist:{id:'1',name:'A'} as never,duration:100,access:'playable',streamUrl:'https://secret'} as never)).not.toHaveProperty('streamUrl');
    expect(compactTrack({id:'',title:'T'} as never)).toBe(null);
  });
});
