import {expect,it,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
it('F12 toggles native DevTools once per keydown, without page messages',()=>{
 const events=new Map<string,Function>();let opened=false;
 const open=vi.fn(()=>{opened=true;}),close=vi.fn(()=>{opened=false;});
 class Window {
  webContents={session:{setPermissionRequestHandler:vi.fn()},on:(name:string,handler:Function)=>events.set(name,handler),setWindowOpenHandler:vi.fn(),isDevToolsOpened:()=>opened,openDevTools:open,closeDevTools:close};
  once=vi.fn();loadURL=()=>Promise.resolve();show=vi.fn();
 }
 const electron={app:{whenReady:()=>({then:(fn:Function)=>fn()}),on:vi.fn()},BrowserWindow:Window,shell:{openExternal:vi.fn()},ipcMain:{handle:vi.fn()}};
 vm.runInNewContext(fs.readFileSync('electron/distributed.cjs','utf8'),{URL,require:(id:string)=>id==='electron'?electron:id==='node:path'?path:{url:'https://oskolok.lol/'},__dirname:'/fixture/electron',process:{platform:'win32'}});
 const preventDefault=vi.fn(),handler=events.get('before-input-event')!;
 handler({preventDefault},{type:'keyDown',key:'F12'});expect(open).toHaveBeenCalledWith({mode:'detach'});
 handler({preventDefault},{type:'keyUp',key:'F12'});expect(open).toHaveBeenCalledTimes(1);
 handler({preventDefault},{type:'keyDown',key:'F12'});expect(close).toHaveBeenCalledTimes(1);expect(preventDefault).toHaveBeenCalledTimes(2);
});
