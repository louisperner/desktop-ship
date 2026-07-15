const { app, BrowserWindow, globalShortcut, screen, ipcMain, dialog, shell, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const pty = require('node-pty');
const { startControlServer } = require('./control-server');
const { startRendererServer } = require('./server');

let win;
let tray = null;    // menu bar / system tray handle (keep a ref so it isn't GC'd)
let control = null; // control server handle (close on quit)
let rendererBaseUrl = null; // http://127.0.0.1:PORT — set before the window loads
let localFileToken = null; // secret required to read local files via /__local/

// ---- renderer round-trip for the control server ----
// Each external command is forwarded to the renderer and matched back by id.
let ctlSeq = 0;
const ctlPending = new Map();
function invokeRenderer(method, params) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed()) return reject(new Error('cockpit window not ready'));
    const id = ++ctlSeq;
    const timer = setTimeout(() => {
      ctlPending.delete(id);
      reject(new Error(`renderer timeout for "${method}"`));
    }, 10000);
    ctlPending.set(id, { resolve, reject, timer });
    win.webContents.send('control:invoke', { id, method, params });
  });
}

let clickThrough = false;
let alwaysOnTop = false; // default: sit behind every other window (desktop widget)
let displayIndex = 0;
const terms = new Map(); // node-pty shell sessions keyed by tab id, lazily spawned

// Resolve which display to use: --display=N CLI arg or COCKPIT_DISPLAY env var.
function pickInitialDisplay() {
  const displays = screen.getAllDisplays();
  const arg = process.argv.find((a) => a.startsWith('--display='));
  const raw = arg ? arg.split('=')[1] : process.env.COCKPIT_DISPLAY;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n < displays.length ? n : 0;
}

// Position + size the window to fully cover the given display.
function placeOnDisplay(index) {
  const displays = screen.getAllDisplays();
  displayIndex = ((index % displays.length) + displays.length) % displays.length;
  const { bounds } = displays[displayIndex];
  win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  // Re-assert the current stacking level after a move (some platforms drop it).
  applyStackLevel();
  win.webContents.send('display-changed', {
    index: displayIndex,
    count: displays.length,
  });
}

function createWindow() {
  const display = screen.getAllDisplays()[pickInitialDisplay()];
  const { x, y, width, height } = display.bounds;

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // enables the <webview> tag used by the BROWSER widget
      backgroundThrottling: true, // throttle rAF/timers while the window is hidden
    },
  });

  // Grant media (camera/mic) requests ONLY to the cockpit's own top frame, so
  // camera-stream widgets can use getUserMedia. Arbitrary sites navigated inside
  // the <webview> browser widget get their own webContents and are denied, so
  // they can never silently grab the camera/mic.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const isCockpit = win && !win.isDestroyed() && wc === win.webContents;
    cb(isCockpit && (permission === 'media' || permission === 'mediaKeySystem'));
  });
  // Also deny non-cockpit frames for synchronous permission checks.
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    const isCockpit = win && !win.isDestroyed() && wc === win.webContents;
    return isCockpit && (permission === 'media' || permission === 'mediaKeySystem');
  });

  // Show the cockpit on every workspace, including over fullscreen apps.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Default: pinned behind every other window like a desktop widget.
  applyStackLevel();

  win.webContents.on('console-message', (_e, _lvl, msg) => { if (msg.startsWith('[DBG]')) console.log(msg); });
  displayIndex = pickInitialDisplay();
  loadCockpit();
  // The window always captures the mouse — no click-through.
}

// Load the cockpit over http://127.0.0.1 (so embedded players like YouTube see a
// valid http origin). On the very first http launch we migrate the user's old
// localStorage, which lived under the previous file:// origin and is otherwise
// invisible to the new origin — this restores their saved widgets and layout.
async function loadCockpit() {
  const httpUrl = rendererBaseUrl + '/src/renderer/index.html';
  const flag = path.join(app.getPath('userData'), '.migrated-to-http');
  const indexFile = path.join(__dirname, 'renderer', 'index.html');

  if (!fs.existsSync(flag)) {
    try {
      // 1. Load the legacy file:// page and snapshot its localStorage.
      await win.loadFile(indexFile);
      const dump = await win.webContents.executeJavaScript('JSON.stringify(localStorage)');
      // 2. Switch to the http origin.
      await win.loadURL(httpUrl);
      // 3. Import any keys the new origin doesn't already have, then reload once
      //    so the app picks them up.
      const imported = await win.webContents.executeJavaScript(
        `(() => { const d = JSON.parse(${JSON.stringify(dump)}); let n = 0;
          for (const k in d) { if (localStorage.getItem(k) === null) { localStorage.setItem(k, d[k]); n++; } }
          return n; })()`
      );
      if (imported > 0) win.reload();
    } catch (e) {
      console.error('localStorage migration failed:', e);
      await win.loadURL(httpUrl);
    }
    try { fs.writeFileSync(flag, new Date().toISOString()); } catch (_e) {}
  } else {
    win.loadURL(httpUrl);
  }
}

function setClickThrough(enabled) {
  clickThrough = enabled;
  // forward:true lets mouse-move events still reach the renderer for hover UI.
  win.setIgnoreMouseEvents(enabled, { forward: true });
  win.webContents.send('clickthrough-changed', enabled);
}

// Apply the current pin state: floating above everything, or dropped to the
// normal window level so any other window can surface above the cockpit.
// Crucially we do NOT blur or force-focus here — that would stop the cockpit's
// own UI from receiving clicks while it is the frontmost window.
function applyStackLevel() {
  if (!win) return;
  if (alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    win.setAlwaysOnTop(false);
  }
}

function setAlwaysOnTop(enabled) {
  alwaysOnTop = enabled;
  applyStackLevel();
  win.webContents.send('always-on-top-changed', enabled);
}

// Bring DesktopShip back to the foreground and make it the key window so its UI
// and keyboard shortcuts work again. Used by the cockpit click handler and the
// tray icon.
function focusCockpit() {
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
  win.webContents.focus();
}

// Menu bar (macOS) / system tray (Windows) icon: a one-click way to recover the
// cockpit when it's behind other windows or you've clicked through to apps below.
function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, 'renderer', 'assets', 'cockpit.png'))
    .resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('Desktop Ship');

  // Fire-and-forget a control command at the renderer (settings live there).
  const ctl = (method, params) => invokeRenderer(method, params).catch(() => {});

  // Build the menu, pulling live settings state from the renderer so the
  // checkboxes reflect reality. Falls back to defaults if the renderer isn't
  // ready yet (e.g. first build during startup).
  const rebuildMenu = async () => {
    if (!tray) return;
    let s = {};
    try { s = await invokeRenderer('get_settings', {}); } catch (_e) { s = {}; }

    const displays = screen.getAllDisplays();
    const displayItems = displays.map((d, i) => ({
      label: `${d.label || `Display ${i + 1}`}  (${d.bounds.width}×${d.bounds.height})`,
      type: 'radio', checked: i === displayIndex,
      click: () => placeOnDisplay(i),
    }));

    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Focus Cockpit', click: () => focusCockpit() },
      { label: win && win.isVisible() ? 'Hide' : 'Show', click: () => {
        if (win.isVisible()) win.hide(); else { win.show(); focusCockpit(); }
      } },
      { type: 'separator' },
      { label: 'Pin on top', type: 'checkbox', checked: alwaysOnTop,
        click: () => setAlwaysOnTop(!alwaysOnTop) },
      { label: 'Click-through', type: 'checkbox', checked: clickThrough,
        click: () => setClickThrough(!clickThrough) },
      { type: 'separator' },
      { label: 'Settings', submenu: [
        { label: 'Solid background', type: 'checkbox', checked: !!s.bgFill,
          click: () => ctl('toggle_bg_fill') },
        { label: 'Show grid', type: 'checkbox', checked: !!s.gridShow,
          click: () => ctl('toggle_grid') },
        { label: 'Snap to grid', type: 'checkbox', checked: !!s.snap,
          click: () => ctl('toggle_snap') },
        { type: 'separator' },
        { label: 'Open settings panel…', click: () => { ctl('open_settings', { open: true }); focusCockpit(); } },
        { label: 'Reset layout', click: () => ctl('reset_layout') },
      ] },
      { label: 'Display', submenu: displayItems.length ? displayItems : [{ label: 'No displays', enabled: false }] },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  };
  rebuildMenu();
  // Refresh checkbox/label state each time the menu is about to open.
  tray.on('mouse-enter', rebuildMenu);
  // Left-click the icon → just focus the cockpit (most common need).
  tray.on('click', () => focusCockpit());
}

app.whenReady().then(async () => {
  // Serve from the project root: index.html references ../../node_modules assets,
  // so the http root must be high enough to reach them. A FIXED port keeps the
  // page origin stable across launches so localStorage persists.
  const { baseUrl, localToken } = await startRendererServer(path.join(__dirname, '..'), 51789);
  rendererBaseUrl = baseUrl;
  localFileToken = localToken;

  // Harden every <webview> guest: strip any preload, keep Node disabled, and
  // block attempts to raise privileges. Without this an injected <webview> could
  // request nodeIntegration or a preload and break out of the renderer sandbox.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (_evt, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.webSecurity = true;
      delete params.nodeintegration;
    });
    // Guests may not spawn new BrowserWindows; open links externally instead.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  createWindow();
  createTray();

  // Toggle interactivity: when "click-through" is on, clicks pass to apps below.
  globalShortcut.register('CommandOrControl+Alt+C', () => {
    setClickThrough(!clickThrough);
  });

  // Quick hide/show of the whole cockpit.
  globalShortcut.register('CommandOrControl+Alt+H', () => {
    if (win.isVisible()) win.hide();
    else win.show();
  });

  // Cycle the cockpit to the next monitor.
  globalShortcut.register('CommandOrControl+Alt+M', () => {
    placeOnDisplay(displayIndex + 1);
  });

  // Keep covering a display even if monitors are plugged/unplugged.
  screen.on('display-added', () => placeOnDisplay(displayIndex));
  screen.on('display-removed', () => placeOnDisplay(displayIndex));

  // Pin/unpin the cockpit on top of all other windows.
  globalShortcut.register('CommandOrControl+Alt+T', () => {
    setAlwaysOnTop(!alwaysOnTop);
  });

  ipcMain.on('set-clickthrough', (_e, enabled) => setClickThrough(enabled));
  ipcMain.on('set-always-on-top', (_e, enabled) => setAlwaysOnTop(enabled));
  // Whole-window opacity. Clamp to a usable range so the cockpit never vanishes.
  ipcMain.on('set-opacity', (_e, value) =>
    win.setOpacity(Math.min(1, Math.max(0.2, Number(value) || 1))));
  // Renderer drives this while in passive mode: ignore clicks over empty
  // space, but capture them when the cursor is over a panel/button.
  ipcMain.on('set-ignore', (_e, ignore) =>
    win.setIgnoreMouseEvents(ignore, { forward: true }));
  // Clicking a solid part of the cockpit pulls DesktopShip back to the front so
  // its UI and keyboard shortcuts work again after interacting with apps behind.
  ipcMain.on('focus-window', () => focusCockpit());
  ipcMain.on('set-display', (_e, index) => placeOnDisplay(index));
  ipcMain.handle('list-displays', () =>
    screen.getAllDisplays().map((d, i) => ({
      index: i,
      label: d.label || `Display ${i + 1}`,
      width: d.bounds.width,
      height: d.bounds.height,
      primary: d.id === screen.getPrimaryDisplay().id,
      active: i === displayIndex,
    }))
  );
  ipcMain.on('quit', () => app.quit());

  // ---- control server: renderer replies routed back to the WS client ----
  ipcMain.on('control:result', (_e, { id, ok, result, error }) => {
    const p = ctlPending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    ctlPending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new Error(error || 'renderer error'));
  });
  control = startControlServer(invokeRenderer);

  // ---- Filesystem helpers (folder widget + local file pickers) ----
  // List a directory's entries (folders first, then files, alphabetical).
  ipcMain.handle('fs-read-dir', (_e, dir) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.'))
        .map((d) => ({ name: d.name, isDir: d.isDirectory(), path: path.join(dir, d.name) }));
      entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      return { ok: true, dir, entries };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  // Native file/folder picker. dir:true picks a directory, else a single file.
  // NOTE: we deliberately do NOT pass `win` as the parent. The cockpit window is
  // frameless/transparent and never takes focus, so attaching the dialog to it
  // produces an invisible modal sheet that freezes the whole UI. A parentless
  // dialog opens as its own focusable window instead.
  ipcMain.handle('fs-pick', async (_e, { dir } = {}) => {
    const res = await dialog.showOpenDialog({
      properties: [dir ? 'openDirectory' : 'openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  // Open a path with the OS default handler (used by folder widget items).
  ipcMain.handle('fs-open-path', (_e, p) => shell.openPath(p));
  // Open a URL in the user's default browser (e.g. embed-blocked YouTube videos).
  // Only web/mail schemes are allowed — this refuses file://, and other schemes
  // that could launch local handlers or execute code.
  ipcMain.handle('open-external', (_e, url) => {
    let scheme;
    try { scheme = new URL(String(url)).protocol; } catch { return false; }
    if (scheme !== 'http:' && scheme !== 'https:' && scheme !== 'mailto:') return false;
    return shell.openExternal(String(url));
  });

  // Hand the renderer the per-launch token it needs to build /__local/ URLs.
  ipcMain.on('get-local-token', (e) => { e.returnValue = localFileToken; });

  // ---- Terminal: real shell sessions via node-pty, one per tab (keyed by id) ----
  ipcMain.on('term-start', (_e, { id, cols, rows } = {}) => {
    if (terms.has(id)) return; // already running; reuse the session
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'zsh');
    const session = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: os.homedir(),
      env: process.env,
    });
    terms.set(id, session);
    session.onData((data) => win && win.webContents.send('term-data', { id, data }));
    session.onExit(() => { terms.delete(id); win && win.webContents.send('term-exit', { id }); });
  });
  ipcMain.on('term-input', (_e, { id, data }) => {
    const s = terms.get(id);
    if (s) s.write(data);
  });
  ipcMain.on('term-resize', (_e, { id, cols, rows }) => {
    const s = terms.get(id);
    if (s) try { s.resize(cols, rows); } catch {}
  });
  ipcMain.on('term-kill', (_e, { id }) => {
    const s = terms.get(id);
    if (s) { terms.delete(id); try { s.kill(); } catch {} }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const s of terms.values()) try { s.kill(); } catch {}
  terms.clear();
  if (control) try { control.close(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
