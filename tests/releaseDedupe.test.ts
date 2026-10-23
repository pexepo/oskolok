import {describe,expect,it} from 'vitest';
import {dedupeReleases} from '../server/src/services/releaseDedupe.js';

describe('dedupeReleases',()=>{
  it('keeps two releases of one service whose titles differ only in punctuation',()=>{
    const out=dedupeReleases([{id:'deezer:album:1',title:'Shh!'},{id:'deezer:album:2',title:'Shh...'}]);
    expect(out.map(r=>r.id)).toEqual(['deezer:album:1','deezer:album:2']);
  });
  it('merges the same release listed by two services, matching the exact spelling first',()=>{
    const out=dedupeReleases([{id:'spotify:album:a',title:'Shh...'},{id:'deezer:album:1',title:'Shh!'},{id:'deezer:album:2',title:'Shh...'}]);
    expect(out.map(r=>r.id)).toEqual(['spotify:album:a','deezer:album:1']);
  });
  it('drops a duplicate of one service and keeps the explicit edition and EP label',()=>{
    const out=dedupeReleases([{id:'deezer:album:1',title:'Damage',type:'single'},{id:'deezer:album:2',title:'Damage (Explicit)',explicit:true},{id:'spotify:album:x',title:'damage',type:'ep'}]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({id:'deezer:album:2',type:'ep'});
  });
});
