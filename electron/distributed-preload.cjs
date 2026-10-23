const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('oskolokDesktop', {
  retry: () => ipcRenderer.invoke('retry-connection'),
  // Desktop extras: the web app reports playback for the mini-player and Discord, and receives their buttons.
  info: () => ipcRenderer.invoke('desktop-info').catch(() => null),
  nowPlaying: state => ipcRenderer.send('desktop-now-playing', state),
  setPrefs: prefs => ipcRenderer.send('desktop-prefs', prefs),
  toggleMini: () => ipcRenderer.send('desktop-toggle-mini'),
  // Over-the-air shell updates.
  updateState: () => ipcRenderer.invoke('desktop-update-state').catch(() => null),
  checkUpdate: () => ipcRenderer.invoke('desktop-update-check').catch(() => null),
  installUpdate: () => ipcRenderer.send('desktop-update-install'),
  onUpdate: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('desktop-update', handler);
    return () => ipcRenderer.removeListener('desktop-update', handler);
  },
  onCommand: callback => {
    const handler = (_event, action) => callback(String(action));
    ipcRenderer.on('desktop-command', handler);
    return () => ipcRenderer.removeListener('desktop-command', handler);
  },
});
