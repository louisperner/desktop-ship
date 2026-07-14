// Dynamic click-through ("passive mode").
//
// The cockpit covers the whole screen, but most of it is decorative and marked
// `pointer-events: none` in CSS (stars, HUD, canopy, vignette, glass…). Only
// real UI (panels, buttons, holos, hotbar, modals) is `pointer-events: auto`.
//
// On top of that, the cockpit plate (.cockpit-img) is a PNG with a transparent
// windshield: its *solid* pixels count as cockpit you can grab (clicking them
// captures the click and brings DesktopShip back to focus), while the
// transparent windshield/sky lets the click fall through to the app behind.
//
// document.elementFromPoint() skips every `pointer-events: none` layer, so the
// element it returns over empty space is the document body/root. We combine that
// with a per-pixel alpha test of the cockpit image to decide, on every move,
// whether the window should swallow the click or let it pass through. main.js
// applies it via setIgnoreMouseEvents, and `forward: true` keeps mouse-move
// events flowing to us even while ignored.
(function passthrough() {
  let ignoring = null;   // current state pushed to main (null = unknown)
  let forcedOff = false; // global click-through fully on → always ignore

  // --- Cockpit plate alpha sampling -------------------------------------------
  const ALPHA_THRESHOLD = 10;  // 0..255; pixels above this count as "solid"
  // Fallback when per-pixel alpha can't be read (tainted canvas / load error):
  // treat the bottom band of the plate as solid cockpit so focus is always easy
  // to recover. The windshield (top) keeps passing through.
  const FALLBACK_SOLID_FROM = 0.55; // fraction of plate height; below = solid
  const imgEl = document.querySelector('.cockpit-img');
  let alpha = null;            // Uint8 alpha plane, or null if unreadable
  let geometricFallback = false;
  let nw = 0, nh = 0;          // natural image dimensions

  if (imgEl) {
    const probe = new Image();
    probe.onload = () => {
      nw = probe.naturalWidth; nh = probe.naturalHeight;
      try {
        const c = document.createElement('canvas');
        c.width = nw; c.height = nh;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(probe, 0, 0);
        const data = ctx.getImageData(0, 0, nw, nh).data; // throws if tainted
        const a = new Uint8Array(nw * nh);
        let solid = 0;
        for (let i = 0; i < a.length; i++) { a[i] = data[i * 4 + 3]; if (a[i] >= ALPHA_THRESHOLD) solid++; }
        // If essentially nothing reads as solid the data is unusable — fall back.
        if (solid > a.length * 0.01) alpha = a; else geometricFallback = true;
      } catch (_e) {
        geometricFallback = true; // tainted canvas
      }
      if (geometricFallback) console.log('[DBG] passthrough: alpha unreadable, using geometric cockpit band');
    };
    probe.onerror = () => { geometricFallback = true; nw = nh = 1; };
    probe.src = imgEl.src;
  }

  // Is (x, y) over a solid (non-transparent) part of the cockpit plate?
  // Maps screen coords → element box (getBoundingClientRect already bakes in the
  // live zoom/lift transform) → object-fit:cover, object-position:center bottom.
  function overSolidCockpit(x, y) {
    if (!imgEl || !nw) return false;
    const r = imgEl.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    const cover = Math.max(r.width / nw, r.height / nh);
    const renderedW = nw * cover, renderedH = nh * cover;
    const offsetX = (r.width - renderedW) / 2;   // center
    const offsetY = r.height - renderedH;        // bottom
    const ix = Math.floor(((x - r.left) - offsetX) / cover);
    const iy = Math.floor(((y - r.top) - offsetY) / cover);
    if (ix < 0 || ix >= nw || iy < 0 || iy >= nh) return false;
    if (alpha) return alpha[iy * nw + ix] >= ALPHA_THRESHOLD;
    // Geometric fallback: lower band of the plate is solid cockpit.
    return iy >= nh * FALLBACK_SOLID_FROM;
  }

  // --- Solid background -------------------------------------------------------
  // When the user turns on the solid-color background fill (#bgFill), it covers
  // the whole screen and clicks must NOT pass through it. Detect it by the
  // element's actual rendered background alpha.
  const bgFillEl = document.getElementById('bgFill');
  function bgIsSolid() {
    if (!bgFillEl) return false;
    const bg = getComputedStyle(bgFillEl).backgroundColor; // e.g. "rgba(4,10,14,0.5)"
    if (!bg || bg === 'transparent') return false;
    const m = bg.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/);
    const a = m ? parseFloat(m[1]) : 1; // rgb(...) with no alpha → opaque
    return a > 0.02;
  }

  // --- Hit testing ------------------------------------------------------------
  function isInteractive(x, y) {
    if (bgIsSolid()) return true; // solid fill covers everything → always capture
    const el = document.elementFromPoint(x, y);
    if (el && el !== document.body && el !== document.documentElement) return true;
    return overSolidCockpit(x, y);
  }

  function apply(ignore) {
    if (ignore === ignoring) return;
    ignoring = ignore;
    window.cockpit.setIgnore(ignore);
  }

  function update(x, y) {
    if (forcedOff) { apply(true); return; }
    apply(!isInteractive(x, y));
  }

  let lastX = 0, lastY = 0;
  window.addEventListener('mousemove', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    update(e.clientX, e.clientY);
  }, true);

  // A DOM mousedown only fires when the click actually landed on the window
  // (passed-through clicks never reach the DOM — forward:true relays moves, not
  // clicks). So any mousedown we see means a real panel/button hit: pull
  // DesktopShip to the front 100% of the time, regardless of heuristic state.
  window.addEventListener('mousedown', () => window.cockpit.focusWindow(), true);

  // Re-evaluate when the UI changes under a stationary cursor (panel opens/closes,
  // holo appears, cockpit lift transition) — otherwise the state would only
  // refresh on the next move.
  const recheck = () => update(lastX, lastY);
  new MutationObserver(recheck).observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['hidden', 'style', 'class'],
  });

  // When the user flips full click-through on (Ctrl+Alt+C), let it win: ignore
  // everything. When it's off, hand control back to the hover logic.
  window.cockpit.onClickThroughChanged((on) => {
    forcedOff = on;
    recheck();
  });

  // Start in passthrough: empty space lets clicks reach the desktop behind.
  apply(true);
})();
