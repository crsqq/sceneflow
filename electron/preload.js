const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge between Electron and Frontend
contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
});
