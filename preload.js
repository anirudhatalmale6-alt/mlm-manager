const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mlm', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  login: (email, password) => ipcRenderer.invoke('api-login', email, password),
  getTasks: () => ipcRenderer.invoke('api-get-tasks'),
  getTaskDetail: (taskId) => ipcRenderer.invoke('api-get-task-detail', taskId),
  getProfiles: (taskId, amount) => ipcRenderer.invoke('api-get-profiles', taskId, amount),
  getStatistics: (taskId) => ipcRenderer.invoke('api-get-statistics', taskId),
  startProfile: (workgroup, profileId) => ipcRenderer.invoke('api-start-profile', workgroup, profileId),
  cancelProfile: (taskId, profileId) => ipcRenderer.invoke('api-cancel-profile', taskId, profileId),
  moveToGroup: (taskId, profileIds, group) => ipcRenderer.invoke('api-move-to-group', taskId, profileIds, group),
  getBrowsers: () => ipcRenderer.invoke('get-browsers'),
  focusWindow: (id, title) => ipcRenderer.invoke('focus-window', id, title),
  minimizeWindow: (id) => ipcRenderer.invoke('minimize-window', id),
  closeWindow: (id, title) => ipcRenderer.invoke('close-window', id, title),
  positionWindows: (opts) => ipcRenderer.invoke('position-windows', opts),
  sendDiscordScreenshot: (channel) => ipcRenderer.invoke('send-discord-screenshot', channel),
  openUrlInBrowsers: (url) => ipcRenderer.invoke('open-url-in-browsers', url),
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_, action) => callback(action))
});
