import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {compareVersions} from '../server/src/services/releases.js';
const require=createRequire(import.meta.url);
const {variantOf,macAppPath,macInstallScript}=require('../electron/updater.cjs');

describe('desktop over-the-air updates',()=>{
  it('compares versions numerically',()=>{
    expect(compareVersions('1.10.0','1.9.9')).toBe(1);
    expect(compareVersions('1.2.0','1.2.0')).toBe(0);
    expect(compareVersions('1.2.0-beta.1','1.2.0')).toBe(-1);
    expect(compareVersions('1.1.1','1.2.0')).toBe(-1);
  });
  it('asks for the build of its own kind',()=>{
    expect(variantOf('win32','x64',{})).toEqual({platform:'windows',variant:'installer'});
    expect(variantOf('win32','x64',{PORTABLE_EXECUTABLE_FILE:'C:\\Oskolok.exe'})).toEqual({platform:'windows',variant:'portable'});
    expect(variantOf('darwin','arm64',{})).toEqual({platform:'macos',variant:'arm64'});
    expect(variantOf('linux','x64',{})).toBeNull();
  });
  it('never replaces an app running from the DMG or a translocated copy',()=>{
    expect(macAppPath('/Volumes/Oskolok/Oskolok.app/Contents/MacOS/Oskolok')).toBeNull();
    expect(macAppPath('/private/var/folders/x/AppTranslocation/ABC/d/Oskolok.app/Contents/MacOS/Oskolok')).toBeNull();
  });
  it('swaps the bundle only after the app exits, with quoted paths',()=>{
    const s=macInstallScript({dmg:"/Users/a b/Library/Oskolok/updates/1.3.0-Oskolok-arm64.dmg",app:"/Applications/Oskolok.app",pid:4242,relaunch:true});
    expect(s.split('\n')[0]).toBe('while kill -0 4242 2>/dev/null; do sleep 0.3; done');
    expect(s).toContain("'/Users/a b/Library/Oskolok/updates/1.3.0-Oskolok-arm64.dmg'");
    expect(s).toContain('mv "$APP.new" "$APP"');
    expect(s.trim().endsWith('open "$APP"')).toBe(true);
    expect(macInstallScript({dmg:'/x.dmg',app:"/Applications/O'k.app",pid:1,relaunch:false})).toContain("APP='/Applications/O'\\''k.app'");
  });
});
