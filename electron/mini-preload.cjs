const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('oskolokMini', {
  onState: callback => { ipcRenderer.on('mini-state', (_event, state) => callback(state)); },
  send: action => ipcRenderer.send('mini-action', String(action)),
});
