const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  apiBase: `http://127.0.0.1:${process.env.PORT || '5000'}/api`,
  setTitleBarOverlay: (options) => ipcRenderer.invoke('set-title-bar-overlay', options),
});
