const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startStream: (settings) => ipcRenderer.send('start-stream', { settings }),
  stopStream: () => ipcRenderer.send('stop-stream'),
  sendChunk: (arrayBuffer) => ipcRenderer.send('stream-chunk', arrayBuffer),
  selectRecordingDir: () => ipcRenderer.invoke('select-recording-dir'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  getHardwareInfo: () => ipcRenderer.invoke('get-hardware-info'),
  
  createWebSource: (sourceId, url, width, height, fps) => ipcRenderer.send('create-web-source', { sourceId, url, width, height, fps }),
  resizeWebSource: (sourceId, width, height) => ipcRenderer.send('resize-web-source', { sourceId, width, height }),
  destroyWebSource: (sourceId) => ipcRenderer.send('destroy-web-source', { sourceId }),
  
  onWebSourcePaint: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('web-source-paint', subscription);
    return () => ipcRenderer.removeListener('web-source-paint', subscription);
  },
  
  onStreamStatus: (callback) => {
    const subscription = (event, status) => callback(status);
    ipcRenderer.on('stream-status', subscription);
    return () => ipcRenderer.removeListener('stream-status', subscription);
  },
  
  onStreamStats: (callback) => {
    const subscription = (event, stats) => callback(stats);
    ipcRenderer.on('stream-stats', subscription);
    return () => ipcRenderer.removeListener('stream-stats', subscription);
  },
  
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close')
});
