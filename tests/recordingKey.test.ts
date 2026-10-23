import {describe,it,expect} from 'vitest';
import {recordingKey,sameRecording,sourceRank} from '../server/src/services/recordingKey.js';
import {mapGeniusSong} from '../server/src/services/GeniusSongService.js';

describe('one song across catalogues',()=>{
  it('never treats repeated digits or letters as the same title',()=>{
    expect(sameRecording({title:'100',artist:{name:'Artist'},duration:180},{title:'10',artist:{name:'Artist'},duration:180})).toBe(false);
    expect(recordingKey({title:'Baad',artist:{name:'Artist'}})).not.toBe(recordingKey({title:'Bad',artist:{name:'Artist'}}));
  });
  it('treats the Spotify and SoundCloud copies of a song as one recording',()=>{
    const spotify={title:'Давай сбежим',artist:{name:'Sqwore'},duration:154};
    const soundcloud={title:'давай сбежим',artist:{name:'sqwore'},duration:155};
    expect(recordingKey(spotify)).toBe(recordingKey(soundcloud));
    expect(sameRecording(spotify,soundcloud)).toBe(true);
    expect(sourceRank({source:'spotify'})).toBeLessThan(sourceRank({source:'soundcloud'}));
  });
  it('keeps featured credits out of the key but versions in it',()=>{
    expect(recordingKey({title:'ящики (feat. BOOKER)',artist:{name:'mzlff, BOOKER'}})).toBe(recordingKey({title:'ящики',artist:{name:'mzlff'}}));
    expect(recordingKey({title:'ящики (sped up)',artist:{name:'mzlff'}})).not.toBe(recordingKey({title:'ящики',artist:{name:'mzlff'}}));
  });
  it('never merges copies whose lengths disagree',()=>{
    expect(sameRecording({title:'A',artist:{name:'B'},duration:173},{title:'A',artist:{name:'B'},duration:150})).toBe(false);
  });
});

describe('Genius song credits',()=>{
  it('groups credits by role and lifts the label out of the people list',()=>{
    const info=mapGeniusSong({id:1,url:'https://genius.com/x',title:'Hollywood',primary_artist:{id:9,name:'Слава КПСС (Slava KPSS)',image_url:'https://images.genius.com/a.png'},
      description:{plain:'?'},release_date:'2022-10-21',featured_artists:[],producer_artists:[{id:2,name:'Veelva Beats'}],writer_artists:[{id:9,name:'Слава КПСС (Slava KPSS)'}],
      custom_performances:[{label:'Mixing Engineer',artists:[{name:'spbwaves',image_url:'https://assets.genius.com/images/default_cover_image.png'}]},{label:'Label',artists:[{name:'The Fence'}]}],song_relationships:[]});
    expect(info.description).toBeUndefined();
    expect(info.releaseDate).toBe('2022-10-21');
    expect(info.credits.map(c=>c.role)).toEqual(['Producer','Writer','Mixing Engineer']);
    expect(info.credits[2].people[0].image).toBeUndefined();
    expect(info.labels).toEqual(['The Fence']);
  });
});
