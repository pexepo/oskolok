import {describe,it,expect} from 'vitest';
import {normalizeSocialLink,normalizeSocialLinks,profileCustomizationSchema,customizationColumns,readCustomization,ProfileValidationError} from '../server/src/services/profileCustomization.js';
import {roleInputSchema} from '../server/src/services/roles.js';

describe('profile customisation',()=>{
  it('detects platforms and normalises handles',()=>{
    expect(normalizeSocialLink({url:'@pexepo'})).toEqual({platform:'telegram',url:'https://t.me/pexepo'});
    expect(normalizeSocialLink({url:'vk.com/durov'}).platform).toBe('vk');
    expect(normalizeSocialLink({url:'https://music.yandex.ru/users/x'}).platform).toBe('yandexMusic');
    expect(normalizeSocialLink({platform:'discord',url:'Some_User.1'})).toEqual({platform:'discord',url:'some_user.1'});
  });
  it('rejects unsafe or private links',()=>{
    for(const url of ['javascript:alert(1)','https://localhost/x','http://127.0.0.1','https://user:pw@example.com','ftp://example.com'])
      expect(()=>normalizeSocialLink({url})).toThrow(ProfileValidationError);
  });
  it('caps the list and drops duplicates',()=>{
    expect(normalizeSocialLinks([{url:'https://github.com/a'},{url:'https://github.com/a'}])).toHaveLength(1);
    expect(()=>normalizeSocialLinks(Array.from({length:11},(_,i)=>({url:`https://example.com/${i}`})))).toThrow();
  });
  it('validates colour and keeps visibility partial updates',()=>{
    expect(()=>profileCustomizationSchema.parse({accentColor:'red'})).toThrow();
    const input=profileCustomizationSchema.parse({accentColor:'#FF5C7A',visibility:{stats:false}});
    const cols=customizationColumns(input,JSON.stringify({nowPlaying:false}));
    expect(cols.accentColor).toBe('#ff5c7a');
    expect(JSON.parse(cols.profileVisibility!)).toMatchObject({nowPlaying:false,stats:false,showcase:true});
    expect(readCustomization({accentColor:'nope',profileTheme:'weird'} as any)).toMatchObject({accentColor:null,theme:'default'});
  });
});

describe('roles',()=>{
  it('validates name, colour and icon',()=>{
    expect(roleInputSchema.parse({name:'  Разработчик ',color:'#7C9CFF',icon:'code'})).toMatchObject({name:'Разработчик',color:'#7c9cff',hoist:true});
    expect(()=>roleInputSchema.parse({name:'',color:'#7c9cff'})).toThrow();
    expect(()=>roleInputSchema.parse({name:'x',color:'blue'})).toThrow();
    expect(()=>roleInputSchema.parse({name:'x',color:'#000000',icon:'not-an-icon'})).toThrow();
  });
});
