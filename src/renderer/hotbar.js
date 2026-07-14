// ============================================================================
// HOTBAR — an always-open quick-action bar pinned to the bottom of the cockpit.
// It never closes; it just offers four shortcuts:
//   • BG       — toggle the transparent / solid background fill
//   • HOLO     — show / hide every panel currently in holo mode (.as-holo)
//   • SETTINGS — show / hide the settings panel
//   • CLOSE    — quit the app
// BG and SETTINGS piggyback on the existing dashboard controls so all the
// persistence/state logic stays in one place; the hotbar only mirrors them.
// ============================================================================
(function hotbar() {
  const $ = (id) => document.getElementById(id);

  // ---- BG: drive the settings' bgFill toggle, mirror its state ----
  const bgSrc = $('bgFillToggle');
  const hbBg = $('hbBg');
  function syncBg() { hbBg.classList.toggle('active', bgSrc.textContent.trim() === 'ON'); }
  hbBg.addEventListener('click', () => { bgSrc.click(); syncBg(); });
  syncBg();

  // ---- HOLO: hide/show all holo-mode panels via a body class ----
  const HOLO_KEY = 'cockpit.hotbar.holohidden.v1';
  const hbHolo = $('hbHolo');
  function applyHolo(hidden) {
    document.body.classList.toggle('holo-hidden', hidden);
    // "active" = panels visible (the default, lit) state.
    hbHolo.classList.toggle('active', !hidden);
    localStorage.setItem(HOLO_KEY, hidden ? '1' : '0');
  }
  hbHolo.addEventListener('click', () =>
    applyHolo(!document.body.classList.contains('holo-hidden')));
  applyHolo(localStorage.getItem(HOLO_KEY) === '1');

  // ---- SETTINGS: drive the dashboard settings toggle, mirror its state ----
  const setSrc = $('settingsToggle');
  const hbSettings = $('hbSettings');
  function syncSettings() { hbSettings.classList.toggle('active', setSrc.classList.contains('active')); }
  hbSettings.addEventListener('click', () => { setSrc.click(); syncSettings(); });
  // The settings panel can also be opened/closed elsewhere; keep in sync.
  new MutationObserver(syncSettings).observe(setSrc, { attributes: true, attributeFilter: ['class'] });
  syncSettings();

  // ---- PIN: keep the cockpit window always on top, mirror its state ----
  const hbPin = $('hbPin');
  let pinned = false;
  function applyPin(on) {
    pinned = on;
    hbPin.classList.toggle('active', on);
  }
  hbPin.addEventListener('click', () => {
    applyPin(!pinned);
    window.cockpit.setAlwaysOnTop(pinned);
  });
  // The tray menu / shortcut can also toggle this; stay in sync.
  window.cockpit.onAlwaysOnTopChanged(applyPin);

  // ---- CLOSE: quit the app ----
  $('hbQuit').addEventListener('click', () => window.cockpit.quit());

  // ---- Make the hotbar a draggable/resizable panel, exactly like an MFD.
  // The panel system handles move (via the .drag header), resize (auto grip),
  // persistence and cockpit lift-following — no custom logic needed.
  if (window.CockpitPanels) window.CockpitPanels.make($('hotbar'), { minW: 200, minH: 60 });
})();
