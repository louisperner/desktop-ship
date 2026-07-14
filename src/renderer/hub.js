// ============================================================================
// PANELS — the control center for everything floating in the cockpit. Both
// widgets and ship MFDs are treated as "panels" here. A search box filters the
// active tab; two tabs organise the content:
//   • ADD     — catalog of panel types; pick one, fill its config, spawn a new
//               holographic instance (any number of each).
//   • ACTIVE  — live panels: widget instances (SHOW/HIDE + REMOVE), the ship
//               MFDs (SHOW/HIDE + HOLO), and interface chrome (HOLO).
// Hidden-panel and holo-mode state persist across launches.
// ============================================================================
(function hub() {
  const HID_KEY = 'cockpit.hub.hidden.v1';
  const HOLO_KEY = 'cockpit.hub.asholo.v1';
  const TAB_KEY = 'cockpit.hub.tab.v1';

  const hidden = new Set(loadArr(HID_KEY));
  const asHolo = new Set(loadArr(HOLO_KEY));
  let tab = localStorage.getItem(TAB_KEY) || 'add';
  let query = '';

  function loadArr(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } }
  function saveSet(k, s) { localStorage.setItem(k, JSON.stringify([...s])); }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const match = (label) => !query || String(label).toLowerCase().includes(query);

  // Dashboard MFD panels.
  const PANELS = [
    { id: 'mfd-power', ico: '⋮', label: 'POWER' },
    { id: 'mfd-nav', ico: '◵', label: 'PWR · NAV' },
    { id: 'mfd-comp', ico: '⊹', label: 'TGT · COMP' },
    { id: 'mfd-sensors', ico: '❖', label: 'SENSORS' },
    { id: 'mfd-thrust', ico: '➤', label: 'THRUST' },
  ];
  // Interface chrome that can also be turned holographic.
  const INTERFACE = [
    { id: 'holoDock', ico: '⊞', label: 'WIDGET DOCK' },
    { id: 'console', ico: '▭', label: 'TERMINAL' },
    { id: 'settings', ico: '⚙', label: 'SETTINGS' },
  ];

  const bodyEl = document.getElementById('hubBody');
  const H = window.CockpitHolos;

  // ---- holo / hidden state on real DOM ----
  function applyHidden(id) { const el = document.getElementById(id); if (el) el.classList.toggle('hub-hidden', hidden.has(id)); }
  function applyHolo(id) { const el = document.getElementById(id); if (el) el.classList.toggle('as-holo', asHolo.has(id)); }
  function setHidden(id, on) { if (on) hidden.add(id); else hidden.delete(id); saveSet(HID_KEY, hidden); applyHidden(id); syncPanelRow(id); }
  function setHolo(id, on) { if (on) asHolo.add(id); else asHolo.delete(id); saveSet(HOLO_KEY, asHolo); applyHolo(id); syncPanelRow(id); }

  // ---- a managed panel row (MFD or interface chrome) ----
  function panelRow(item, opts) {
    const el = document.createElement('div');
    el.className = 'hub-item';
    el.dataset.id = item.id;
    el.innerHTML =
      `<span class="hub-ico">${item.ico}</span><span class="hub-name">${esc(item.label)}</span>` +
      `<span class="hub-actions">` +
      (opts.toggle ? `<button class="hub-act" data-act="toggle"></button>` : '') +
      `<button class="hub-act" data-act="holo"></button></span>`;
    if (opts.toggle) el.querySelector('[data-act="toggle"]').addEventListener('click', () => setHidden(item.id, !hidden.has(item.id)));
    el.querySelector('[data-act="holo"]').addEventListener('click', () => setHolo(item.id, !asHolo.has(item.id)));
    return el;
  }
  function syncPanelRow(id) {
    const el = bodyEl.querySelector(`.hub-item[data-id="${id}"]`);
    if (!el) return;
    const toggle = el.querySelector('[data-act="toggle"]');
    if (toggle) {
      const isHidden = hidden.has(id);
      toggle.textContent = isHidden ? 'CLOSED' : 'OPEN';
      toggle.classList.toggle('off', isHidden);
    }
    const holo = el.querySelector('[data-act="holo"]');
    const isHolo = asHolo.has(id);
    holo.textContent = isHolo ? '◈ HOLO' : '◇ HOLO';
    holo.classList.toggle('on', isHolo);
  }

  // ---- ADD catalog ----
  function buildCatalog(container) {
    const grid = document.createElement('div');
    grid.className = 'hub-cat';
    container.appendChild(grid);
    const form = document.createElement('div');
    form.className = 'hub-form';
    form.hidden = true;
    container.appendChild(form);

    let shown = 0;
    H.catalog().forEach((c) => {
      if (!match(c.label) && !match(c.type)) return;
      shown++;
      const card = document.createElement('button');
      card.className = 'hub-card';
      card.innerHTML = `<span class="hub-card-ico">${c.ico}</span><span class="hub-card-label">${esc(c.label)}</span>`;
      card.addEventListener('click', () => openForm(c, form, grid));
      grid.appendChild(card);
    });
    if (!shown) container.appendChild(muted('no panels match'));
  }

  // Inline config form for the chosen type (or instant-add when no fields).
  function openForm(c, form, grid) {
    if (!c.configFields.length) { H.addWidget(c.type); return; }
    grid.querySelectorAll('.hub-card').forEach((b) => b.classList.remove('sel'));
    form.hidden = false;
    form.innerHTML = `<div class="hub-form-head">${c.ico} ${esc(c.label)}</div>`;
    const inputs = {};
    c.configFields.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'hub-field';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = f.placeholder || f.label;
      row.innerHTML = `<label>${esc(f.label)}</label>`;
      const wrap = document.createElement('div');
      wrap.className = 'hub-field-input';
      wrap.appendChild(inp);
      if (f.file) {
        const pick = document.createElement('button');
        pick.className = 'hub-pick';
        pick.textContent = f.dir ? '🗀' : 'ₑ';
        pick.title = f.dir ? 'choose folder' : 'choose file';
        pick.addEventListener('click', async () => {
          const p = await window.cockpit.fs.pick({ dir: !!f.dir });
          if (p) inp.value = p;
        });
        wrap.appendChild(pick);
      }
      row.appendChild(wrap);
      form.appendChild(row);
      inputs[f.key] = inp;
    });
    const actions = document.createElement('div');
    actions.className = 'hub-form-actions';
    actions.innerHTML = `<button class="hub-act on" data-do="add">+ ADD</button><button class="hub-act" data-do="cancel">CANCEL</button>`;
    form.appendChild(actions);
    actions.querySelector('[data-do="add"]').addEventListener('click', () => {
      const cfg = {};
      Object.keys(inputs).forEach((k) => { cfg[k] = inputs[k].value; });
      H.addWidget(c.type, cfg);
      form.hidden = true;
    });
    actions.querySelector('[data-do="cancel"]').addEventListener('click', () => { form.hidden = true; });
  }

  // ---- ACTIVE panels list ----
  function buildActive(container) {
    let shown = 0;
    // Live widget instances.
    const insts = H.instances().filter((w) => match(w.label));
    if (insts.length) container.appendChild(section('WIDGETS'));
    insts.forEach((w) => {
      shown++;
      const el = document.createElement('div');
      el.className = 'hub-item';
      el.dataset.wid = w.id;
      el.innerHTML =
        `<span class="hub-ico">${w.ico}</span><span class="hub-name">${esc(w.label)}</span>` +
        `<span class="hub-actions">` +
        `<button class="hub-act" data-act="toggle">${w.open ? 'OPEN' : 'CLOSED'}</button>` +
        `<button class="hub-act danger-sw" data-act="remove">✕</button></span>`;
      const toggle = el.querySelector('[data-act="toggle"]');
      toggle.classList.toggle('off', !w.open);
      toggle.addEventListener('click', () => H.setOpen(w.id, !H.isOpen(w.id)));
      el.querySelector('[data-act="remove"]').addEventListener('click', () => { H.removeWidget(w.id); build(); });
      container.appendChild(el);
    });

    // Ship MFD panels.
    const ships = PANELS.filter((p) => match(p.label));
    if (ships.length) { container.appendChild(section('SHIP PANELS')); ships.forEach((p) => { container.appendChild(panelRow(p, { toggle: true })); syncPanelRow(p.id); shown++; }); }

    // Interface chrome.
    const ui = INTERFACE.filter((p) => match(p.label));
    if (ui.length) { container.appendChild(section('INTERFACE')); ui.forEach((p) => { container.appendChild(panelRow(p, { toggle: false })); syncPanelRow(p.id); shown++; }); }

    if (!shown) container.appendChild(muted('no panels match'));
  }

  // ---- build whole HUB body ----
  function section(title) { const s = document.createElement('div'); s.className = 'hub-section'; s.textContent = title; return s; }
  function muted(text) { const m = document.createElement('div'); m.className = 'hub-muted'; m.textContent = text; return m; }

  function build() {
    bodyEl.innerHTML = '';

    // Search box.
    const search = document.createElement('div');
    search.className = 'hub-search';
    search.innerHTML = `<span class="hub-search-ico">⌕</span>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'search panels…';
    input.value = query;
    input.addEventListener('input', () => { query = input.value.trim().toLowerCase(); rebuildContent(); input.focus(); });
    search.appendChild(input);
    bodyEl.appendChild(search);

    // Tabs (with live counts).
    const addCount = H.catalog().length;
    const activeCount = H.instances().length + PANELS.length + INTERFACE.length;
    const tabs = document.createElement('div');
    tabs.className = 'hub-tabs';
    [['add', 'ADD', addCount], ['active', 'ACTIVE', activeCount]].forEach(([key, label, n]) => {
      const b = document.createElement('button');
      b.className = 'hub-tab' + (tab === key ? ' on' : '');
      b.innerHTML = `${label} <span class="hub-tab-n">${n}</span>`;
      b.addEventListener('click', () => { tab = key; localStorage.setItem(TAB_KEY, tab); build(); });
      tabs.appendChild(b);
    });
    bodyEl.appendChild(tabs);

    // Tab content host.
    const content = document.createElement('div');
    content.className = 'hub-content';
    bodyEl.appendChild(content);
    rebuildContent();
  }

  // Re-render just the active tab's content (used on search / data change).
  function rebuildContent() {
    const content = bodyEl.querySelector('.hub-content');
    if (!content) return;
    content.innerHTML = '';
    if (tab === 'add') buildCatalog(content);
    else buildActive(content);
  }

  // Restore persisted state on the real DOM at load.
  PANELS.forEach((p) => { applyHidden(p.id); applyHolo(p.id); });
  INTERFACE.forEach((p) => { applyHolo(p.id); });

  build();

  // Keep the ACTIVE list in sync when panels toggle/add/remove elsewhere.
  if (H) H.onChange = () => { if (tab === 'active') rebuildContent(); };

  // ---- PANELS now lives inside Settings: the toggle opens the settings
  // panel (if closed) and jumps to its Panels tab ----
  document.getElementById('hubToggle').addEventListener('click', () => {
    const settings = document.getElementById('settings');
    if (settings.hidden) document.getElementById('settingsToggle').click();
    document.querySelector('.set-tab[data-tab="panels"]')?.click();
  });
})();
