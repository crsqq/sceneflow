const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge between Electron and Frontend
contextBridge.exposeInMainWorld('electronAPI', {
  // Future IPC communication methods can be added here
});
