const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cockpit', {
  setClickThrough: (enabled) => ipcRenderer.send('set-clickthrough', enabled),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  focusWindow: () => ipcRenderer.send('focus-window'),
  quit: () => ipcRenderer.send('quit'),
  onClickThroughChanged: (cb) =>
    ipcRenderer.on('clickthrough-changed', (_e, enabled) => cb(enabled)),

  setAlwaysOnTop: (enabled) => ipcRenderer.send('set-always-on-top', enabled),
  onAlwaysOnTopChanged: (cb) =>
    ipcRenderer.on('always-on-top-changed', (_e, enabled) => cb(enabled)),

  setOpacity: (value) => ipcRenderer.send('set-opacity', value),

  listDisplays: () => ipcRenderer.invoke('list-displays'),
  setDisplay: (index) => ipcRenderer.send('set-display', index),
  onDisplayChanged: (cb) =>
    ipcRenderer.on('display-changed', (_e, info) => cb(info)),

  // ---- Filesystem (folder widget + local file pickers) ----
  fs: {
    readDir: (dir) => ipcRenderer.invoke('fs-read-dir', dir),
    pick: (opts) => ipcRenderer.invoke('fs-pick', opts),
    openPath: (p) => ipcRenderer.invoke('fs-open-path', p),
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Per-launch secret for building /__local/ file URLs (see server.js).
  localToken: ipcRenderer.sendSync('get-local-token'),

  // ---- Control channel (external MCP-driven commands) ----
  control: {
    onInvoke: (cb) => ipcRenderer.on('control:invoke', (_e, msg) => cb(msg)),
    result: (payload) => ipcRenderer.send('control:result', payload),
  },

  // ---- Terminal ----
  term: {
    start: (id, size) => ipcRenderer.send('term-start', { id, ...size }),
    input: (id, data) => ipcRenderer.send('term-input', { id, data }),
    resize: (id, size) => ipcRenderer.send('term-resize', { id, ...size }),
    kill: (id) => ipcRenderer.send('term-kill', { id }),
    onData: (cb) => ipcRenderer.on('term-data', (_e, { id, data }) => cb(id, data)),
    onExit: (cb) => ipcRenderer.on('term-exit', (_e, { id }) => cb(id)),
  },
});
