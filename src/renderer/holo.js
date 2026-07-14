// ============================================================================
// Hologram widgets — instance based. A catalog of widget TYPES (clock, systems,
// star map, vessel, ship log, plus rich content: image, video, folder, google
// map, spotify, camera) can each be spawned any number of times. Every instance
// is a draggable / resizable translucent holographic panel (via CockpitPanels)
// whose type + config + open state persist across launches. Geometry is stored
// by CockpitPanels keyed on the instance's element id.
//
// Instances are created/removed from the PANEL HUB (see hub.js); the projector
// dock here acts as a quick "add a widget" palette.
// ============================================================================
(function holos() {
  const body = document.body;
  const INST_KEY = 'cockpit.widgets.v1';

  const $$ = (el, sel) => el.querySelector(sel);

  // ---- helpers shared by content widgets -------------------------------------
  // Turn a bare filesystem path into a file:// URL (leaves real URLs untouched).
  function toUrl(s) {
    s = (s || '').trim();
    if (!s) return '';
    if (/^[a-z]+:\/\//i.test(s) || s.startsWith('data:')) return s;
    if (s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s)) {
      // The page is served over http://127.0.0.1, which cannot load file:// URLs.
      // Route absolute local paths through the renderer server's /__local/ handler.
      const b64 = btoa(unescape(encodeURIComponent(s)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return location.origin + '/__local/' + b64;
    }
    return s;
  }
  // Normalize what the user typed in the browser address bar: full URLs pass
  // through, a bare host (has a dot, no spaces) gets https://, everything else
  // becomes a Google search.
  function normUrl(s) {
    s = (s || '').trim();
    if (!s) return '';
    if (/^[a-z]+:\/\//i.test(s) || s.startsWith('about:') || s.startsWith('data:')) return s;
    if (/^[^\s.]+\.[^\s]+$/.test(s) && !s.includes(' ')) return 'https://' + s;
    return 'https://www.google.com/search?q=' + encodeURIComponent(s);
  }
  function ytId(url) {
    const m = (url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    return m ? m[1] : null;
  }
  // Accepts a Spotify share link or URI, returns its /embed/<type>/<id> URL.
  function spotifyEmbed(s) {
    s = (s || '').trim();
    let m = s.match(/spotify[:/](track|album|playlist|artist|show|episode)[:/]([\w]+)/i);
    if (!m) m = s.match(/open\.spotify\.com\/(track|album|playlist|artist|show|episode)\/([\w]+)/i);
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}?theme=0` : '';
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- widget type catalog ---------------------------------------------------
  // configFields: [{ key, label, placeholder, file?, dir? }]. `media:true`
  // makes the body edge-to-edge (no padding) for img/video/iframe content.
  const TYPES = {
    clock: {
      ico: '◷', label: 'CHRONO', w: 200, h: 120,
      render: () => `<div class="hc-time">--:--:--</div><div class="hc-date"></div>`,
    },
    sys: {
      ico: '▦', label: 'SYSTEMS', w: 220, h: 150,
      render: () => `
        <div class="holo-row"><span>CPU</span><div class="holo-bar2"><i data-k="cpu"></i></div><b data-kv="cpu">0%</b></div>
        <div class="holo-row"><span>MEM</span><div class="holo-bar2"><i data-k="mem"></i></div><b data-kv="mem">0%</b></div>
        <div class="holo-row"><span>NET</span><div class="holo-bar2"><i data-k="net"></i></div><b data-kv="net">0%</b></div>`,
      init: (el) => { el.__sv = { cpu: 24, mem: 47, net: 12 }; },
    },
    map: {
      ico: '✷', label: 'STAR MAP', w: 200, h: 220,
      render: () => `<svg viewBox="0 0 120 120" class="holo-map">
        <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(120,230,255,0.5)"/>
        <circle cx="60" cy="60" r="34" fill="none" stroke="rgba(120,230,255,0.35)"/>
        <circle cx="60" cy="60" r="16" fill="none" stroke="rgba(120,230,255,0.25)"/>
        <line x1="60" y1="8" x2="60" y2="112" stroke="rgba(120,230,255,0.18)"/>
        <line x1="8" y1="60" x2="112" y2="60" stroke="rgba(120,230,255,0.18)"/>
        <g class="holo-orbit"><circle cx="60" cy="12" r="3.5" fill="#7fe6ff"/></g>
        <g class="holo-orbit" style="animation-duration:11s"><circle cx="94" cy="60" r="2.5" fill="#6effb0"/></g>
        <circle cx="60" cy="60" r="3" fill="#e6faff"/></svg>`,
    },
    ship: {
      ico: '➤', label: 'VESSEL', w: 170, h: 210,
      render: () => `<svg viewBox="0 0 80 100" class="holo-ship">
        <g class="holo-ship-spin">
          <polygon points="40,6 52,40 48,68 64,90 40,78 16,90 32,68 28,40" fill="none" stroke="#7fe6ff" stroke-width="1.5"/>
          <line x1="40" y1="6" x2="40" y2="78" stroke="rgba(120,230,255,0.4)"/>
        </g></svg>`,
    },
    log: {
      ico: '✎', label: 'SHIP LOG', w: 240, h: 160,
      render: () => `<textarea class="holo-note" placeholder="ship log entry..."></textarea>`,
      init: (el, cfg, id) => {
        const t = $$(el, '.holo-note');
        t.value = localStorage.getItem('cockpit.holonote.' + id) || '';
        t.addEventListener('input', () => localStorage.setItem('cockpit.holonote.' + id, t.value));
      },
    },

    title: {
      ico: 'T', label: 'TITLE', w: 360, h: 180,
      render: () => `<div class="holo-title">
        <div class="holo-title-ctl">
          <input class="holo-title-color" type="color" title="color" />
          <div class="holo-dd holo-title-font" title="font"></div>
          <div class="holo-dd holo-title-size" title="size"></div>
          <button class="holo-title-holo sw" title="holographic glow">HOLO</button>
          <button class="holo-title-done sw" title="show only the title">✓ DONE</button>
        </div>
        <div class="holo-title-stage">
          <input class="holo-title-text" type="text" placeholder="your title" />
          <button class="holo-title-edit" title="edit title">✎</button>
        </div>
      </div>`,
      init: (el, cfg, id) => initTitle(el, id),
    },

    notepad: {
      ico: '✑', label: 'NOTEPAD', w: 320, h: 280,
      render: () => `<div class="holo-pad">
        <input class="holo-pad-title" type="text" placeholder="title…" />
        <textarea class="holo-pad-text" placeholder="write…" spellcheck="false"></textarea>
        <div class="holo-pad-foot"><span class="holo-pad-saved"></span><span class="holo-pad-count">0 words · 0 chars</span></div>
      </div>`,
      init: (el, cfg, id) => initNotepad(el, id),
    },

    todo: {
      ico: '✓', label: 'TASKS', w: 240, h: 220,
      render: () => `<div class="holo-todo">
        <form class="holo-todo-add"><input type="text" placeholder="add task…" /></form>
        <div class="holo-todo-list"></div></div>`,
      init: (el, cfg, id) => initTodo(el, id),
    },

    image: {
      ico: '⊡', label: 'IMAGE', w: 320, h: 240, media: true,
      configFields: [{ key: 'src', label: 'Image URL or file', placeholder: 'https://… or pick a file', file: true }],
      render: (cfg) => cfg.src
        ? `<img class="holo-media" src="${esc(toUrl(cfg.src))}" alt=""/>`
        : `<div class="holo-empty">no image</div>`,
    },
    video: {
      ico: '⏵', label: 'VIDEO', w: 360, h: 220, media: true, windowMode: true,
      configFields: [{ key: 'src', label: 'Video URL or file', placeholder: 'mp4 / YouTube / pick a file', file: true }],
      render: (cfg) => {
        if (!cfg.src) return `<div class="holo-empty">no video</div>`;
        const yt = ytId(cfg.src);
        if (yt) return `<iframe class="holo-media" src="https://www.youtube-nocookie.com/embed/${yt}?rel=0" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>` +
          `<a class="holo-yt-open" data-id="${yt}" title="Open on YouTube">↗ YouTube</a>`;
        return `<video class="holo-media" src="${esc(toUrl(cfg.src))}" controls></video>`;
      },
      init: (el) => {
        const link = el.querySelector('.holo-yt-open');
        if (link) link.addEventListener('click', () => {
          window.cockpit.openExternal('https://www.youtube.com/watch?v=' + link.dataset.id);
        });
      },
    },
    folder: {
      ico: '⊞', label: 'FOLDER', w: 280, h: 280,
      configFields: [{ key: 'path', label: 'Folder', placeholder: 'pick a folder', file: true, dir: true }],
      render: () => `<div class="holo-folder"><div class="holo-folder-path"></div><div class="holo-folder-list"></div></div>`,
      init: (el, cfg) => loadFolder(el, cfg.path),
    },
    gmap: {
      ico: '◍', label: 'MAP', w: 340, h: 280, media: true,
      configFields: [{ key: 'q', label: 'Place or address', placeholder: 'e.g. Tokyo Tower' }],
      render: (cfg) => cfg.q
        ? `<iframe class="holo-media" src="https://www.google.com/maps?q=${encodeURIComponent(cfg.q)}&output=embed" frameborder="0"></iframe>`
        : `<div class="holo-empty">no location</div>`,
    },
    spotify: {
      ico: '♫', label: 'SPOTIFY', w: 320, h: 180, media: true,
      configFields: [{ key: 'uri', label: 'Spotify link', placeholder: 'open.spotify.com/… or spotify:…' }],
      render: (cfg) => {
        const u = spotifyEmbed(cfg.uri);
        return u
          ? `<iframe class="holo-media" src="${esc(u)}" allow="encrypted-media; autoplay" frameborder="0"></iframe>`
          : `<div class="holo-empty">paste a Spotify link</div>`;
      },
    },
    camera: {
      ico: '⦿', label: 'CAMERA', w: 320, h: 240, media: true, hd: true,
      configFields: [{ key: 'url', label: 'Stream URL (blank = webcam)', placeholder: 'http://…/mjpeg or blank' }],
      render: (cfg) => {
        if (cfg.url) {
          return /\.(m3u8|mp4|webm)(\?|$)/i.test(cfg.url)
            ? `<video class="holo-media" src="${esc(cfg.url)}" autoplay muted controls></video>`
            : `<img class="holo-media" src="${esc(cfg.url)}" alt=""/>`; // MJPEG / snapshot
        }
        // Webcam mode: a control bar (source / resolution / fps) over the feed.
        // These are CUSTOM dropdowns (built by makeDropdown), not native
        // <select> — native popups don't open in this unfocused desktop-widget
        // window, so the dropdown menu is plain HTML we position ourselves.
        return `<div class="holo-cam">
          <div class="holo-cam-ctl">
            <div class="holo-dd holo-cam-dev" title="video source"></div>
            <div class="holo-dd holo-cam-mic" title="audio source"></div>
            <div class="holo-dd holo-cam-aud" title="audio mode"></div>
            <div class="holo-dd holo-cam-res" title="resolution"></div>
            <div class="holo-dd holo-cam-fps" title="frame rate"></div>
            <button class="holo-cam-fx" title="hologram effect on/off">FX</button>
          </div>
          <video class="holo-media" autoplay muted playsinline></video>
          <div class="holo-cam-stat"></div></div>`;
      },
      init: (el, cfg, id) => {
        // FX off strips the hologram treatment (tint/scanlines/flicker) from
        // this panel only. The class lives on the panel element (not the body),
        // so it must be re-applied here after every body rerender.
        el.classList.toggle('holo--nofx', cfg.fx === false);
        if (!cfg.url) startWebcam(el, id, cfg);
      },
      destroy: stopWebcam,
    },
    browser: {
      ico: '⊕', label: 'BROWSER', w: 640, h: 460, media: true, windowMode: true,
      configFields: [{ key: 'url', label: 'Home URL', placeholder: 'https://… (default: google)' }],
      render: (cfg) => {
        const url = normUrl(cfg.url) || 'https://www.google.com';
        return `<div class="holo-web">
          <div class="holo-web-bar">
            <button class="holo-web-btn holo-web-back" title="back" disabled>‹</button>
            <button class="holo-web-btn holo-web-fwd" title="forward" disabled>›</button>
            <button class="holo-web-btn holo-web-reload" title="reload">⟳</button>
            <input class="holo-web-url" type="text" spellcheck="false" placeholder="search or enter address" />
            <button class="holo-web-btn holo-web-ext" title="open in default browser">↗</button>
          </div>
          <webview class="holo-media holo-web-view" src="${esc(url)}" allowpopups
            partition="persist:cockpit-browser"></webview>
        </div>`;
      },
      init: (el, cfg, id) => initBrowser(el, cfg, id),
    },
  };
  const CATALOG_ORDER = ['browser', 'image', 'video', 'folder', 'gmap', 'spotify', 'camera', 'todo', 'notepad', 'title', 'clock', 'sys', 'map', 'ship', 'log'];

  // ---- folder + camera content helpers --------------------------------------
  async function loadFolder(el, dirPath) {
    const pathEl = $$(el, '.holo-folder-path');
    const listEl = $$(el, '.holo-folder-list');
    if (!dirPath) { pathEl.textContent = 'no folder'; listEl.innerHTML = ''; return; }
    pathEl.textContent = dirPath;
    const res = await window.cockpit.fs.readDir(dirPath);
    listEl.innerHTML = '';
    if (!res || !res.ok) { listEl.innerHTML = `<div class="holo-empty">${esc(res && res.error || 'cannot read')}</div>`; return; }
    res.entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'holo-file' + (e.isDir ? ' is-dir' : '');
      row.innerHTML = `<span class="holo-file-ico">${e.isDir ? '🗀' : '🗎'}</span><span class="holo-file-name">${esc(e.name)}</span>`;
      row.addEventListener('click', () => {
        if (e.isDir) loadFolder(el, e.path);          // drill in
        else window.cockpit.fs.openPath(e.path);       // open with OS
      });
      listEl.appendChild(row);
    });
  }

  // Wire the chrome-like browser widget: address bar, back/forward/reload, and
  // an "open externally" button. The <webview> is an isolated guest page.
  function initBrowser(el, cfg, id) {
    const view = $$(el, '.holo-web-view');
    const url = $$(el, '.holo-web-url');
    const back = $$(el, '.holo-web-back');
    const fwd = $$(el, '.holo-web-fwd');
    const reload = $$(el, '.holo-web-reload');
    const ext = $$(el, '.holo-web-ext');
    if (!view) return;

    const syncNav = () => {
      back.disabled = !view.canGoBack();
      fwd.disabled = !view.canGoForward();
    };
    const showUrl = (u) => { if (document.activeElement !== url) url.value = u || ''; };
    // Persist the current page as the widget's restore URL — WITHOUT rerender
    // (setConfig would tear down and reload the webview on every navigation).
    const remember = (u) => { setConfigQuiet(id, { url: u }); };

    view.addEventListener('did-navigate', (e) => { showUrl(e.url); syncNav(); remember(e.url); });
    view.addEventListener('did-navigate-in-page', (e) => { showUrl(e.url); syncNav(); });
    view.addEventListener('page-title-updated', syncNav);
    // Open target=_blank / window.open into the same view instead of a popup.
    view.addEventListener('new-window', (e) => { e.preventDefault(); view.loadURL(e.url); });

    url.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const u = normUrl(url.value);
      if (u) view.loadURL(u);
    });
    back.addEventListener('click', () => view.canGoBack() && view.goBack());
    fwd.addEventListener('click', () => view.canGoForward() && view.goForward());
    reload.addEventListener('click', () => view.reload());
    ext.addEventListener('click', () => {
      const u = view.getURL && view.getURL();
      if (u) window.cockpit.openExternal(u);
    });
  }

  // Per-instance task list, persisted under cockpit.holotodo.<id>.
  function initTodo(el, id) {
    const KEY = 'cockpit.holotodo.' + id;
    const listEl = $$(el, '.holo-todo-list');
    const form = $$(el, '.holo-todo-add');
    const input = $$(form, 'input');
    let items = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } })();
    const save = () => localStorage.setItem(KEY, JSON.stringify(items));

    function draw() {
      listEl.innerHTML = '';
      if (!items.length) { listEl.innerHTML = `<div class="holo-empty">no tasks</div>`; return; }
      items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'holo-task' + (it.done ? ' done' : '');
        row.innerHTML = `<span class="holo-task-box">${it.done ? '☑' : '☐'}</span>` +
          `<span class="holo-task-txt">${esc(it.text)}</span>` +
          `<button class="holo-task-x" title="delete">×</button>`;
        row.querySelector('.holo-task-box').addEventListener('click', () => { items[i].done = !items[i].done; save(); draw(); });
        row.querySelector('.holo-task-txt').addEventListener('click', () => { items[i].done = !items[i].done; save(); draw(); });
        row.querySelector('.holo-task-x').addEventListener('click', () => { items.splice(i, 1); save(); draw(); });
        listEl.appendChild(row);
      });
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = input.value.trim();
      if (!t) return;
      items.push({ text: t, done: false });
      input.value = '';
      save(); draw();
    });
    draw();
  }

  // Per-instance notepad (title + body), persisted under cockpit.holopad.<id>.
  function initNotepad(el, id) {
    const KEY = 'cockpit.holopad.' + id;
    const title = $$(el, '.holo-pad-title');
    const text = $$(el, '.holo-pad-text');
    const saved = $$(el, '.holo-pad-saved');
    const count = $$(el, '.holo-pad-count');
    let data = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
    title.value = data.title || '';
    text.value = data.text || '';
    const updateCount = () => {
      const t = text.value;
      const words = (t.trim().match(/\S+/g) || []).length;
      count.textContent = `${words} words · ${t.length} chars`;
    };
    let timer;
    const save = () => {
      localStorage.setItem(KEY, JSON.stringify({ title: title.value, text: text.value }));
      saved.textContent = 'saved';
      clearTimeout(timer);
      timer = setTimeout(() => { saved.textContent = ''; }, 1200);
    };
    title.addEventListener('input', save);
    text.addEventListener('input', () => { updateCount(); save(); });
    updateCount();
  }

  // Title creator: one big styled line of text with live color / font / size /
  // holographic-glow controls. Persisted under cockpit.holotitle.<id>.
  const TITLE_FONTS = [
    { value: 'inherit', label: 'Cockpit' },
    { value: "'Courier New', monospace", label: 'Mono' },
    { value: 'Georgia, serif', label: 'Serif' },
    { value: 'Arial, sans-serif', label: 'Sans' },
    { value: 'Impact, sans-serif', label: 'Impact' },
  ];
  const TITLE_SIZES = [16, 24, 32, 48, 64, 80, 96];

  function initTitle(el, id) {
    const KEY = 'cockpit.holotitle.' + id;
    const text = $$(el, '.holo-title-text');
    const color = $$(el, '.holo-title-color');
    const fontSel = $$(el, '.holo-title-font');
    const sizeSel = $$(el, '.holo-title-size');
    const holoBtn = $$(el, '.holo-title-holo');
    const doneBtn = $$(el, '.holo-title-done');
    const editBtn = $$(el, '.holo-title-edit');
    let data = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
    data = Object.assign({ text: '', color: '#7fe6ff', font: 'inherit', size: 48, holo: true, done: false }, data);
    const save = () => localStorage.setItem(KEY, JSON.stringify(data));

    function apply() {
      text.style.color = data.color;
      text.style.fontFamily = data.font;
      text.style.fontSize = data.size + 'px';
      color.value = data.color;
      holoBtn.classList.toggle('off', !data.holo);
      holoBtn.textContent = data.holo ? 'HOLO' : 'FLAT';
      text.style.textShadow = data.holo
        ? `0 0 8px ${data.color}, 0 0 18px ${data.color}` : 'none';
      // Done mode: hide every control, show just the title (read-only).
      el.classList.toggle('holo-title--done', data.done);
      text.readOnly = data.done;
    }

    function setDone(on) { data.done = on; apply(); save(); }

    text.value = data.text;
    text.addEventListener('input', () => { data.text = text.value; save(); });
    color.addEventListener('input', () => { data.color = color.value; apply(); save(); });
    makeDropdown(fontSel, TITLE_FONTS, data.font, (v) => { data.font = v; apply(); save(); });
    makeDropdown(sizeSel, TITLE_SIZES.map((s) => ({ value: s, label: s + 'px' })), data.size,
      (v) => { data.size = +v; apply(); save(); });
    holoBtn.addEventListener('click', () => { data.holo = !data.holo; apply(); save(); });
    doneBtn.addEventListener('click', () => setDone(true));
    editBtn.addEventListener('click', () => setDone(false));
    text.addEventListener('dblclick', () => { if (data.done) setDone(false); });
    apply();
  }

  // Custom dropdown: a button showing the current label + a popup menu of
  // options. Used instead of <select> because native popups don't open in this
  // unfocused desktop-widget window. items: [{value, label}].
  //
  // The popup MENU is portaled to <body> with fixed positioning rather than
  // nested inside the button. The camera panel chain (.holo has overflow:hidden
  // + backdrop-filter, .holo-cam-ctl has opacity) forms clipping stacking
  // contexts that trap and hide an in-panel menu, so its options can't be
  // clicked. A body-level fixed menu escapes all of that.
  function makeDropdown(container, items, value, onPick) {
    const cur = items.find((it) => String(it.value) === String(value)) || items[0] || { label: '—' };
    console.log('[DBG] makeDropdown build', container.className, 'items=', items.length, 'value=', value);
    container.innerHTML =
      `<button class="holo-dd-cur">${esc(cur.label)} <span class="holo-dd-arr">▾</span></button>`;
    const curBtn = $$(container, '.holo-dd-cur');

    // Remove every portaled menu currently on screen (state lives in the DOM,
    // not a closure var — a global outside-click handler may have already pulled
    // ours, so we must never assume a cached reference is still attached).
    const closeAll = () => {
      document.querySelectorAll('.holo-dd-menu.portal').forEach((m) => m.remove());
      document.querySelectorAll('.holo-dd.open').forEach((d) => d.classList.remove('open'));
    };

    const openMenu = () => {
      closeAll();
      const menu = document.createElement('div');
      menu.className = 'holo-dd-menu portal';
      items.forEach((it) => {
        const o = document.createElement('button');
        o.className = 'holo-dd-opt' + (String(it.value) === String(value) ? ' sel' : '');
        o.textContent = it.label;
        // mousedown (not click): fires before the document's outside-click
        // handler and before any focus shuffle can swallow the gesture.
        o.addEventListener('mousedown', (e) => { console.log('[DBG] dd option mousedown', container.className, '->', it.value); e.preventDefault(); e.stopPropagation(); closeAll(); onPick(it.value); });
        menu.appendChild(o);
      });
      document.body.appendChild(menu);

      // Position under the button (flip up if it would overflow the viewport).
      const r = curBtn.getBoundingClientRect();
      menu.style.minWidth = r.width + 'px';
      menu.style.left = r.left + 'px';
      const mh = menu.offsetHeight;
      const below = window.innerHeight - r.bottom;
      if (below < mh + 6 && r.top > mh + 6) menu.style.top = (r.top - mh - 3) + 'px';
      else menu.style.top = (r.bottom + 3) + 'px';
      container.classList.add('open');
    };

    // mousedown so the gesture isn't lost to focus changes in this borderless,
    // never-focused desktop window. Toggle off the DOM state, not a stale var.
    curBtn.addEventListener('mousedown', (e) => {
      const wasOpen = container.classList.contains('open');
      console.log('[DBG] dd cur mousedown', container.className, 'wasOpen=', wasOpen);
      e.preventDefault();
      e.stopPropagation();
      closeAll();
      if (!wasOpen) openMenu();
    });
  }

  function stopWebcam(el) {
    const v = $$(el, 'video');
    if (v && v.srcObject) { v.srcObject.getTracks().forEach((t) => t.stop()); v.srcObject = null; }
    // Tear down the AEC loopback (peer connections + hidden audio element).
    if (el.__camPCs) { el.__camPCs.forEach((pc) => pc.close()); el.__camPCs = null; }
    if (el.__camAudio) { el.__camAudio.srcObject = null; el.__camAudio.remove(); el.__camAudio = null; }
  }

  // Chromium's echo canceller only subtracts audio rendered through the WebRTC
  // playout path — a plain <video srcObject> playing the local mic is invisible
  // to it, so self-monitoring echoes forever. Standard workaround: bounce the
  // audio through a local RTCPeerConnection loopback and play the REMOTE end;
  // that playback goes through WebRTC playout and the AEC finally has its
  // reference signal. Returns the loopback stream + both PCs (for cleanup).
  async function aecLoopback(stream) {
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    a.onicecandidate = (e) => { if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {}); };
    b.onicecandidate = (e) => { if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {}); };
    const remote = new Promise((res) => { b.ontrack = (e) => res(e.streams[0]); });
    stream.getAudioTracks().forEach((t) => a.addTrack(t, stream));
    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    return { stream: await remote, pcs: [a, b] };
  }

  // Open a webcam with the requested device / resolution / fps and wire the
  // control bar. Each control persists its choice via setConfig and restarts.
  async function startWebcam(el, id, cfg) {
    cfg = cfg || {};
    const v = $$(el, 'video');
    const devSel = $$(el, '.holo-cam-dev');
    const micSel = $$(el, '.holo-cam-mic');
    const audSel = $$(el, '.holo-cam-aud');
    const resSel = $$(el, '.holo-cam-res');
    const fpsSel = $$(el, '.holo-cam-fps');
    const fxBtn = $$(el, '.holo-cam-fx');
    const stat = $$(el, '.holo-cam-stat');
    if (!v) return;
    stopWebcam(el);

    const [rw, rh] = (cfg.res || '1280x720').split('x').map(Number);
    const fps = +cfg.fps || 30;
    const video = { width: { ideal: rw }, height: { ideal: rh }, frameRate: { ideal: fps } };
    if (cfg.deviceId) video.deviceId = { exact: cfg.deviceId };
    // Audio is opt-in: cfg.mic is '' / undefined for off, or an audioinput
    // deviceId. Two modes (cfg.aud):
    //  'voice' (default) — echoCancellation/NS/AGC on, played via the WebRTC
    //    loopback so the AEC works. Right for a room microphone.
    //  'raw' — all processing off, stereo, played directly. Right for capture
    //    devices / line-in (Elgato & co), where the voice pipeline mangles the
    //    signal (muffled, mono, gain-pumping) and there is no feedback loop.
    const rawAud = cfg.aud === 'raw';
    const audio = cfg.mic
      ? { deviceId: { exact: cfg.mic },
          echoCancellation: !rawAud, noiseSuppression: !rawAud, autoGainControl: !rawAud,
          ...(rawAud ? { channelCount: { ideal: 2 } } : {}) }
      : false;

    try {
      v.srcObject = await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch (err) {
      // Exact device/resolution can fail (e.g. unplugged) — retry unconstrained.
      try { v.srcObject = await navigator.mediaDevices.getUserMedia({ video: true, audio: cfg.mic ? true : false }); }
      catch (e2) { el.querySelector('.holo-body').innerHTML = `<div class="holo-empty">camera blocked: ${esc(e2.message)}</div>`; return; }
    }
    // The <video> stays muted always — when a mic is on, its audio is played
    // through a hidden <audio> fed by the WebRTC loopback so the echo
    // canceller actually sees (and subtracts) what the speakers emit.
    v.muted = true;
    if (cfg.mic && v.srcObject.getAudioTracks().length && rawAud) {
      // Raw mode: direct playback, no loopback — the loopback would re-encode
      // through Opus voice settings and undo the point of raw.
      v.muted = false;
    } else if (cfg.mic && v.srcObject.getAudioTracks().length) {
      try {
        const lb = await aecLoopback(v.srcObject);
        el.__camPCs = lb.pcs;
        const au = document.createElement('audio');
        au.autoplay = true;
        au.srcObject = lb.stream;
        el.appendChild(au);
        el.__camAudio = au;
      } catch (err) {
        // Loopback failed (odd, but possible) — fall back to direct playback,
        // which still works, just without effective echo cancellation.
        v.muted = false;
      }
    }

    const track = v.srcObject.getVideoTracks()[0];
    const s = (track && track.getSettings && track.getSettings()) || {};

    // Device dropdown: pick which camera (labels exist now permission is on).
    if (devSel) {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      if (devs.length < 2) {
        devSel.hidden = true; // nothing to switch to
      } else {
        devSel.hidden = false;
        const items = devs.map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }));
        makeDropdown(devSel, items, s.deviceId, (val) => setConfig(id, { deviceId: val }));
      }
    }
    // Mic dropdown: OFF (default) or any audioinput device.
    if (micSel) {
      const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      if (!mics.length) {
        micSel.hidden = true;
      } else {
        micSel.hidden = false;
        const items = [{ value: '', label: '🔇 no audio' }]
          .concat(mics.map((d, i) => ({ value: d.deviceId, label: '🎙 ' + (d.label || `Mic ${i + 1}`) })));
        makeDropdown(micSel, items, cfg.mic || '', (val) => setConfig(id, { mic: val }));
      }
    }
    // Audio mode dropdown — only meaningful once a mic is active.
    if (audSel) {
      if (!cfg.mic) {
        audSel.hidden = true;
      } else {
        audSel.hidden = false;
        const items = [
          { value: 'voice', label: '🗣 voice (echo cancel)' },
          { value: 'raw', label: '🎵 raw (hi-fi)' },
        ];
        makeDropdown(audSel, items, cfg.aud || 'voice', (val) => setConfig(id, { aud: val }));
      }
    }
    // Resolution + fps dropdowns from their preset lists.
    if (resSel) {
      const items = CAM_RES.map((r) => ({ value: r, label: CAM_RES_LABEL[r] }));
      makeDropdown(resSel, items, cfg.res || '1280x720', (val) => setConfig(id, { res: val }));
    }
    if (fpsSel) {
      const items = CAM_FPS.map((f) => ({ value: f, label: f + 'fps' }));
      makeDropdown(fpsSel, items, fps, (val) => setConfig(id, { fps: +val }));
    }

    // FX toggle: switch the hologram treatment on/off for this panel only.
    // setConfigQuiet — a full rerender would restart the camera for a pure
    // cosmetic change.
    if (fxBtn) {
      let fxOn = cfg.fx !== false;
      const paint = () => {
        fxBtn.classList.toggle('off', !fxOn);
        el.classList.toggle('holo--nofx', !fxOn);
      };
      paint();
      fxBtn.addEventListener('click', () => { fxOn = !fxOn; paint(); setConfigQuiet(id, { fx: fxOn }); });
    }

    // Performance readout: what the camera actually delivered (may differ from
    // the request if the device can't do it).
    if (stat) stat.textContent = `${s.width || rw}×${s.height || rh} · ${Math.round(s.frameRate || fps)}fps`;
  }
  const CAM_RES = ['640x480', '1280x720', '1920x1080', '3840x2160'];
  const CAM_RES_LABEL = { '640x480': '480p', '1280x720': '720p', '1920x1080': '1080p', '3840x2160': '4K' };
  const CAM_FPS = [5, 10, 15, 24, 30, 48, 60, 90, 120];

  // TEMP DIAGNOSTIC: log which element actually receives the press, capture phase.
  document.addEventListener('mousedown', (e) => {
    const t = e.target;
    console.log('[DBG] global mousedown target=', t && t.tagName, t && t.className, 'closest .holo-dd=', !!(t.closest && t.closest('.holo-dd')));
  }, true);

  // Close any open custom dropdown when pressing elsewhere. Uses mousedown to
  // match the dropdowns' own mousedown-driven open/select; a click-phase handler
  // would fire on the very gesture that opened the menu and close it instantly.
  document.addEventListener('mousedown', () => {
    document.querySelectorAll('.holo-dd.open').forEach((d) => d.classList.remove('open'));
    document.querySelectorAll('.holo-dd-menu.portal').forEach((m) => m.remove());
  });

  // ---- instance store --------------------------------------------------------
  let instances = (() => { try { return JSON.parse(localStorage.getItem(INST_KEY)) || []; } catch { return []; } })();
  const els = {}; // id -> panel element
  let counter = instances.reduce((m, w) => Math.max(m, +(w.id.split('-').pop()) || 0), 0);

  function persist() {
    localStorage.setItem(INST_KEY, JSON.stringify(instances.map(({ id, type, cfg, open, win }) => ({ id, type, cfg, open, win }))));
  }

  // Build the DOM panel for an instance and register it with CockpitPanels.
  function build(inst) {
    const def = TYPES[inst.type];
    const baseX = Math.round(window.innerWidth * 0.30);
    const baseY = Math.round(window.innerHeight * 0.20);
    const n = Object.keys(els).length;
    const p = document.createElement('div');
    p.className = 'holo' + (def.media ? ' holo--media' : '');
    p.id = inst.id;
    p.hidden = !inst.open;
    Object.assign(p.style, {
      position: 'fixed', width: def.w + 'px', height: def.h + 'px',
      left: (baseX + (n % 3) * 70) + 'px', top: (baseY + (n % 5) * 48) + 'px',
    });
    p.innerHTML =
      `<div class="holo-bar drag"><span class="holo-ico">${def.ico}</span><span>${esc(def.label)}</span>` +
      (def.windowMode ? `<button class="holo-win" title="window mode — sit behind, no frame">⧉</button>` : '') +
      (def.hd ? `<button class="holo-hd" title="cycle size: 1080p / 1440p / back">HD</button>` : '') +
      `<button class="holo-max" title="maximize — fill the screen">⛶</button>` +
      `<button class="holo-min" title="minimize — hide, reopen from the HUB">—</button>` +
      `<button class="holo-x" title="close for good">×</button></div>` +
      `<div class="holo-body">${def.render(inst.cfg || {})}</div><span class="holo-base"></span>`;
    body.appendChild(p);
    els[inst.id] = p;
    window.CockpitPanels.make(p, { minW: 150, minH: 90 });
    if (def.init) def.init(p, inst.cfg || {}, inst.id);
    // Minimize = hide but keep the instance (restore from the HUB), the old
    // close behavior. Close (×) = remove the widget permanently.
    $$(p, '.holo-min').addEventListener('click', () => setOpen(inst.id, false));
    $$(p, '.holo-x').addEventListener('click', () => removeWidget(inst.id));
    $$(p, '.holo-max').addEventListener('click', () => toggleMax(p));
    if (def.hd) $$(p, '.holo-hd').addEventListener('click', () => toggleHD(p));
    if (def.windowMode) {
      $$(p, '.holo-win').addEventListener('click', () =>
        setWindowMode(p, inst, !p.classList.contains('holo--window')));
      if (inst.win) setWindowMode(p, inst, true, false);
    }
    return p;
  }

  // Toggle a panel between filling the whole screen (100vw × 100vh) and its
  // previous geometry. The pre-maximize rect is stashed on the element.
  function toggleMax(p) {
    const SG = window.CockpitPanels.setGeometry;
    if (p.__maxPrev) {
      SG(p, p.__maxPrev);
      p.__maxPrev = null;
      p.classList.remove('holo--max');
    } else {
      const r = p.getBoundingClientRect();
      p.__maxPrev = { x: r.left, y: r.top, w: r.width, h: r.height };
      SG(p, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
      p.classList.add('holo--max');
    }
  }

  // Cycle a panel through fixed pixel sizes (centered, clamped to the screen
  // origin): 1080p → 1440p → back to the pre-cycle geometry. The button
  // label shows the active step; geometry stash-and-restore as in toggleMax.
  const HD_STEPS = [
    { w: 1920, h: 1080, label: '1080' },
    { w: 2520, h: 1410, label: '1440' },
  ];
  function toggleHD(p) {
    const SG = window.CockpitPanels.setGeometry;
    const btn = $$(p, '.holo-hd');
    const next = p.__hdStep == null ? 0 : p.__hdStep + 1;
    if (next >= HD_STEPS.length) {
      SG(p, p.__hdPrev);
      p.__hdPrev = null;
      p.__hdStep = null;
      p.classList.remove('holo--hd');
      document.body.classList.remove('cam-hd-max');
      btn.textContent = 'HD';
      return;
    }
    if (p.__hdStep == null) {
      const r = p.getBoundingClientRect();
      p.__hdPrev = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    const s = HD_STEPS[next];
    // Never exceed the viewport: a panel wider than the screen pushes the
    // title-bar buttons (close/minimize live at its right edge) off-screen,
    // leaving the user unable to close it.
    const w = Math.min(s.w, window.innerWidth);
    const h = Math.min(s.h, window.innerHeight);
    SG(p, {
      x: Math.round((window.innerWidth - w) / 2),
      y: Math.round((window.innerHeight - h) / 2),
      w, h,
    });
    p.__hdStep = next;
    p.classList.add('holo--hd');
    // At the biggest step the panel reaches the top of the screen, where the
    // RAISE COCKPIT tab (z-index 9999) would float over the feed — drop the
    // tab behind the panel while this step is active.
    document.body.classList.toggle('cam-hd-max', next === HD_STEPS.length - 1);
    btn.textContent = s.label;
  }

  // Enter/leave a panel's window mode. Because a window-mode panel sits at
  // z-index 1 (behind every other widget), an exit control inside it would be
  // trapped under that low stacking context. So the "exit" button lives on
  // <body> at a huge z-index, always clickable on top of everything.
  function setWindowMode(p, inst, on, doPersist = true) {
    p.classList.toggle('holo--window', on);
    inst.win = on;
    if (on && !p.__winExit) {
      const btn = document.createElement('button');
      btn.className = 'win-exit';
      btn.textContent = '✕ EXIT WINDOW MODE';
      btn.title = 'Leave window mode';
      btn.addEventListener('click', () => setWindowMode(p, inst, false));
      document.body.appendChild(btn);
      p.__winExit = btn;
    } else if (!on && p.__winExit) {
      p.__winExit.remove();
      p.__winExit = null;
    }
    if (doPersist) persist();
  }

  // Re-render an existing instance's body (after a config change).
  function rerender(id) {
    const inst = instances.find((w) => w.id === id);
    const el = els[id];
    if (!inst || !el) return;
    const def = TYPES[inst.type];
    if (def.destroy) def.destroy(el);
    $$(el, '.holo-body').innerHTML = def.render(inst.cfg || {});
    if (def.init) def.init(el, inst.cfg || {}, id);
  }

  function addWidget(type, cfg = {}) {
    if (!TYPES[type]) return null;
    const id = `w-${type}-${++counter}`;
    const inst = { id, type, cfg, open: true };
    instances.push(inst);
    build(inst);
    persist();
    fire(id, true);
    return id;
  }

  function removeWidget(id) {
    const i = instances.findIndex((w) => w.id === id);
    if (i < 0) return;
    const def = TYPES[instances[i].type];
    if (def && def.destroy && els[id]) def.destroy(els[id]);
    // Don't leave the RAISE COCKPIT tab sunk if this panel held the big HD step.
    if (els[id] && els[id].classList.contains('holo--hd')) document.body.classList.remove('cam-hd-max');
    if (els[id] && els[id].__winExit) els[id].__winExit.remove();
    if (els[id]) els[id].remove();
    delete els[id];
    instances.splice(i, 1);
    localStorage.removeItem('cockpit.holonote.' + id); // ship-log text, if any
    localStorage.removeItem('cockpit.holotodo.' + id);  // task list, if any
    localStorage.removeItem('cockpit.holopad.' + id);   // notepad text, if any
    localStorage.removeItem('cockpit.holotitle.' + id); // title text, if any
    window.CockpitPanels.forget(id);
    persist();
    fire(id, false);
  }

  function setConfig(id, cfg) {
    const inst = instances.find((w) => w.id === id);
    if (!inst) return;
    inst.cfg = Object.assign({}, inst.cfg, cfg);
    persist();
    rerender(id);
  }

  // Update an instance's config + persist, but DON'T rerender its body. Used by
  // the browser widget to remember the last page without reloading the webview.
  function setConfigQuiet(id, cfg) {
    const inst = instances.find((w) => w.id === id);
    if (!inst) return;
    inst.cfg = Object.assign({}, inst.cfg, cfg);
    persist();
  }

  function setOpen(id, on) {
    const inst = instances.find((w) => w.id === id);
    if (!inst || !els[id]) return;
    inst.open = on;
    els[id].hidden = !on;
    if (!on && els[id].classList.contains('holo--hd')) document.body.classList.remove('cam-hd-max');
    // Keep the floating window-mode exit button in sync with visibility.
    const ex = els[id].__winExit;
    if (ex) ex.style.display = on ? '' : 'none';
    persist();
    fire(id, on);
  }
  function isOpen(id) { return !!(els[id] && !els[id].hidden); }

  function fire(id, on) { if (window.CockpitHolos && window.CockpitHolos.onChange) window.CockpitHolos.onChange(id, on); }

  // Restore saved instances.
  instances.forEach(build);

  // ---- projector dock = quick-add palette -----------------------------------
  const dock = document.createElement('div');
  dock.className = 'holo-dock';
  dock.id = 'holoDock';
  dock.hidden = true;
  dock.innerHTML = `<div class="holo-dock-bar drag">⊞ ADD WIDGET</div><div class="holo-dock-btns"></div>`;
  body.appendChild(dock);
  const btnWrap = $$(dock, '.holo-dock-btns');
  CATALOG_ORDER.forEach((type) => {
    const def = TYPES[type];
    const b = document.createElement('button');
    b.className = 'holo-btn';
    b.textContent = `${def.ico}  ${def.label}`;
    b.addEventListener('click', () => addWidget(type));
    btnWrap.appendChild(b);
  });

  const DOCK_OPEN_KEY = 'cockpit.holodock.open.v1';
  const dockBtn = document.getElementById('holoToggle');
  let dockMade = false;
  function setDockOpen(on) {
    if (on && !dockMade) { window.CockpitPanels.make(dock, { minW: 130, minH: 120 }); dockMade = true; }
    dock.hidden = !on;
    dockBtn.classList.toggle('active', on);
    localStorage.setItem(DOCK_OPEN_KEY, on ? '1' : '0');
  }
  dockBtn.addEventListener('click', () => setDockOpen(dock.hidden));
  if (localStorage.getItem(DOCK_OPEN_KEY) === '1') setDockOpen(true);

  // ---- live updates (per instance) ------------------------------------------
  setInterval(() => {
    const now = new Date();
    const time = now.toLocaleTimeString('en-GB');
    const date = now.toDateString().toUpperCase();
    instances.forEach((w) => {
      if (w.type !== 'clock' || !isOpen(w.id)) return;
      const el = els[w.id];
      $$(el, '.hc-time').textContent = time;
      $$(el, '.hc-date').textContent = date;
    });
  }, 1000);

  setInterval(() => {
    instances.forEach((w) => {
      if (w.type !== 'sys' || !isOpen(w.id)) return;
      const el = els[w.id];
      const sv = el.__sv || (el.__sv = { cpu: 24, mem: 47, net: 12 });
      for (const k of ['cpu', 'mem', 'net']) {
        sv[k] = Math.max(2, Math.min(99, sv[k] + (Math.random() - 0.5) * (k === 'net' ? 22 : 12)));
        const bar = el.querySelector(`[data-k="${k}"]`), val = el.querySelector(`[data-kv="${k}"]`);
        if (bar) bar.style.width = sv[k] + '%';
        if (val) val.textContent = Math.round(sv[k]) + '%';
      }
    });
  }, 1400);

  // ---- public API (used by the HUB) -----------------------------------------
  window.CockpitHolos = {
    // catalog entries with their config metadata, in display order
    catalog: () => CATALOG_ORDER.map((type) => ({
      type, ico: TYPES[type].ico, label: TYPES[type].label,
      configFields: TYPES[type].configFields || [],
    })),
    instances: () => instances.map((w) => ({ id: w.id, type: w.type, cfg: w.cfg, open: w.open, label: TYPES[w.type].label, ico: TYPES[w.type].ico })),
    addWidget, removeWidget, setConfig, setOpen, isOpen,
    onChange: null,
  };

  // Shared UI helper so other modules (settings panel) can build the same custom
  // dropdown that works in this never-focused desktop-widget window.
  window.CockpitUI = { makeDropdown };
})();
