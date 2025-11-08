const { contextBridge, ipcRenderer } = require('electron');

const validInvokeChannels = new Set([
  'steam:fetch-mod-details',
  'steam:fetch-multiple-mod-details',
  'steam:fetch-collection-details',
  'steam:query-files',
  'steam:fetch-mod-details-raw',
  'steam:fetch-mod-workshop-json',
  'steam:get-player-summaries',
  'steam:get-tag-counts',
  'jobs:start-download',
  'jobs:get-all',
  'dialog:select-directory',
  'dialog:select-file',
  'config:get',
  'config:save',
  'profiles:get',
  'profiles:upsert',
  'profiles:delete',
  'mods:get',
  'mods:save',
  'mods:install',
  'mods:remove',
  'mods:disable',
  'mods:enable',
  'mods:check-update',
  'mods:uninstall',
  'collections:get',
  'collections:save',
  'collections:export',
  'collections:import',
  'collections:import-steam',
  'system:show-item',
  'steam:get-app-details',
  'steam:get-app-reviews',
  'steam:get-change-notes',
  'steam:get-comments',
  'window:minimize',
  'window:toggle-maximize',
  'window:close',
  'window:get-state',
]);

contextBridge.exposeInMainWorld('api', {
  invoke(channel, payload) {
    if (!validInvokeChannels.has(channel)) {
      throw new Error(`Attempted to call invalid IPC channel: ${channel}`);
    }

    return ipcRenderer.invoke(channel, payload);
  },
  subscribeDownloads(listener) {
    const channel = 'jobs:update';
    const wrappedListener = (_event, job) => listener(job);
    ipcRenderer.on(channel, wrappedListener);
    ipcRenderer.send('jobs:subscribe');

    return () => {
      ipcRenderer.removeListener(channel, wrappedListener);
    };
  },
});

contextBridge.exposeInMainWorld('environment', {
  isDevelopment: process.env.NODE_ENV === 'development',
  platform: process.platform,
});

contextBridge.exposeInMainWorld('windowControls', {
  minimize() {
    return ipcRenderer.invoke('window:minimize');
  },
  toggleMaximize() {
    return ipcRenderer.invoke('window:toggle-maximize');
  },
  close() {
    return ipcRenderer.invoke('window:close');
  },
  getState() {
    return ipcRenderer.invoke('window:get-state');
  },
  onStateChange(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    const channel = 'window:state';
    const handler = (_event, state) => listener(state);
    ipcRenderer.on(channel, handler);

    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
});

