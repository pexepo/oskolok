const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setTitleBarOverlay: (options) => ipcRenderer.invoke('set-title-bar-overlay', options),
});
