// ============================================================================
// Panel system: every cockpit panel becomes free-floating, draggable by its
// title bar, resizable from the bottom-right grip, optionally grid-snapped, and
// its geometry is persisted to localStorage. Panels start in their default CSS
// layout (flex row, centered console, etc.) and "detach" to absolute position
// the first time they're moved or resized — or on load if a saved geometry
// exists. Exposes window.CockpitPanels for the settings UI.
// ============================================================================
window.CockpitPanels = (function () {
  const LS_KEY = 'cockpit.layout.v2';
  const HANDLE = '.drag, .mfd-head, .console-bar, .settings-bar';

  let layout = (() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch { return {}; }
  })();
  const grid = {
    snap: true, size: 16, show: false,
  };
  const overlay = document.getElementById('gridOverlay');
  const registry = [];
  let z = 50;

  function save() { localStorage.setItem(LS_KEY, JSON.stringify(layout)); }
  function snap(v) { return grid.snap ? Math.round(v / grid.size) * grid.size : Math.round(v); }
  // Current canopy lift in px (0 when lowered). Geometry is always stored in
  // this "base" space — the lift itself is applied via the --bg-lift transform —
  // so panels stay locked to the cockpit and never drift when it moves.
  function liftPx() { return (window.__cockpitLiftPx && window.__cockpitLiftPx()) || 0; }

  function refreshOverlay(dragging) {
    overlay.style.backgroundSize = `${grid.size}px ${grid.size}px`;
    overlay.classList.toggle('on', grid.show || (dragging && grid.snap));
  }

  // Switch a panel from in-flow layout to fixed positioning at its current spot.
  function detach(el) {
    if (el.dataset.floating) return;
    const r = el.getBoundingClientRect();
    // r.top includes any active lift transform; subtract it so the stored top is
    // in base space. The lift is re-applied via translateY(var(--bg-lift)), so
    // the panel tracks the cockpit instead of drifting when it's raised/lowered.
    Object.assign(el.style, {
      position: 'fixed', margin: '0',
      transform: 'translateY(var(--bg-lift, 0px))', flex: 'none',
      transition: 'transform .7s cubic-bezier(.55, .06, .2, 1)',
      maxWidth: 'none', minWidth: '0', maxHeight: 'none',
      left: r.left + 'px', top: (r.top - liftPx()) + 'px',
      width: r.width + 'px', height: r.height + 'px',
      right: 'auto', bottom: 'auto',
    });
    el.dataset.floating = '1';
  }

  // Apply a saved geometry directly (used on load). g is in base space.
  function place(el, g) {
    Object.assign(el.style, {
      position: 'fixed', margin: '0',
      transform: 'translateY(var(--bg-lift, 0px))', flex: 'none',
      transition: 'transform .7s cubic-bezier(.55, .06, .2, 1)',
      maxWidth: 'none', minWidth: '0', maxHeight: 'none',
      left: g.x + 'px', top: g.y + 'px',
      width: g.w + 'px', height: g.h + 'px',
      right: 'auto', bottom: 'auto',
    });
    el.dataset.floating = '1';
  }

  function persist(el) {
    const r = el.getBoundingClientRect();
    layout[el.id] = { x: Math.round(r.left), y: Math.round(r.top - liftPx()), w: Math.round(r.width), h: Math.round(r.height) };
    save();
  }

  function front(el) { el.style.zIndex = ++z; }

  function emitResize(el) { el.dispatchEvent(new CustomEvent('panelresize')); }

  function make(el, opts = {}) {
    opts = Object.assign({ minW: 120, minH: 70 }, opts);
    registry.push({ el, opts });
    if (!el.id) return;

    // Restore saved geometry.
    console.log('[DBG] make', el.id, 'saved=', JSON.stringify(layout[el.id] || null));
    if (layout[el.id]) place(el, layout[el.id]);

    // Resize grip (bottom-right corner).
    const grip = document.createElement('div');
    grip.className = 'resize-grip';
    el.appendChild(grip);

    front(el); // initial stacking by registration order
    el.addEventListener('mousedown', () => front(el), true);

    // ---- Drag ----
    let mode = null, sx, sy, sl, st, sw, sh;
    el.addEventListener('mousedown', (e) => {
      if (e.target === grip) {
        mode = 'resize';
      } else if (e.target.closest(HANDLE) && !e.target.closest('button, input, select')) {
        mode = 'drag';
      } else {
        return;
      }
      detach(el);
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      // Drag math runs in base space (left/top are stored without the lift),
      // while width/height are transform-independent so the rect is fine.
      sl = parseFloat(el.style.left) || 0;
      st = parseFloat(el.style.top) || 0;
      sw = r.width; sh = r.height;
      document.body.classList.add('panel-dragging');
      refreshOverlay(true);
      e.preventDefault();
    });

    window.__panelMove = window.__panelMove || [];
    window.__panelMove.push((e) => {
      if (!mode) return;
      if (mode === 'drag') {
        el.style.left = Math.max(0, snap(sl + (e.clientX - sx))) + 'px';
        el.style.top = Math.max(0, snap(st + (e.clientY - sy))) + 'px';
      } else {
        el.style.width = Math.max(opts.minW, snap(sw + (e.clientX - sx))) + 'px';
        el.style.height = Math.max(opts.minH, snap(sh + (e.clientY - sy))) + 'px';
        emitResize(el);
      }
    });
    window.__panelUp = window.__panelUp || [];
    window.__panelUp.push(() => {
      if (!mode) return;
      const wasResize = mode === 'resize';
      mode = null;
      persist(el);
      document.body.classList.remove('panel-dragging');
      refreshOverlay(false);
      if (wasResize) emitResize(el);
    });
  }

  // Single global move/up dispatch (avoids N listeners fighting).
  document.addEventListener('mousemove', (e) => {
    if (window.__panelMove) for (const fn of window.__panelMove) fn(e);
  });
  document.addEventListener('mouseup', () => {
    if (window.__panelUp) for (const fn of window.__panelUp) fn();
  });

  // Drop a panel's saved geometry + registry entry (used when a widget instance
  // is removed for good, so a future widget reusing the id starts fresh).
  function forget(id) {
    if (layout[id]) { delete layout[id]; save(); }
    const i = registry.findIndex((r) => r.el && r.el.id === id);
    if (i >= 0) registry.splice(i, 1);
  }

  function reset() {
    localStorage.removeItem(LS_KEY);
    layout = {};
    location.reload();
  }

  // ---- Grid controls (called by settings) ----
  function setSnap(on) { grid.snap = on; refreshOverlay(false); }
  function setGridSize(px) { grid.size = px; refreshOverlay(false); }
  function setGridShow(on) { grid.show = on; refreshOverlay(false); }

  // Auto-register every standard panel present at load.
  document.querySelectorAll('.mfd').forEach((el) => make(el, { minW: 120, minH: 90 }));

  refreshOverlay(false);

  // Externally-driven move/resize (used by the control/MCP channel). Accepts a
  // partial geometry; unspecified fields keep their current value.
  function setGeometry(elOrId, g = {}) {
    const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    place(el, {
      x: g.x != null ? snap(g.x) : Math.round(r.left),
      y: g.y != null ? snap(g.y) : Math.round(r.top - liftPx()),
      w: g.w != null ? Math.round(g.w) : Math.round(r.width),
      h: g.h != null ? Math.round(g.h) : Math.round(r.height),
    });
    persist(el);
    emitResize(el);
    return true;
  }

  return {
    make, forget, reset, setSnap, setGridSize, setGridShow, setGeometry,
    get grid() { return grid; },
  };
})();
