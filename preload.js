const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    onLogInfo: (callback) => ipcRenderer.on('log-info', (_event, value) => callback(value))
});
