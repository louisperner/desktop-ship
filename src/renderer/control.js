// ============================================================================
// Control dispatcher (renderer side). Receives commands forwarded from the
// Electron main process (which got them from the WebSocket control server /
// MCP) and runs them against the cockpit's own APIs: CockpitHolos (widgets),
// CockpitPanels (geometry) and window.cockpit (app-level toggles).
//
// Each handler returns a plain JSON-serialisable value; the result (or a thrown
// error) is sent back to main over IPC and on to the MCP client.
// ============================================================================
(function controlDispatcher() {
  const H = () => window.CockpitHolos;
  const P = () => window.CockpitPanels;

  function widgetById(id) {
    const found = H().instances().find((w) => w.id === id);
    if (!found) throw new Error(`unknown widget id: ${id}`);
    return found;
  }

  const handlers = {
    ping: () => ({ ok: true, app: 'desktop-ship' }),

    // ---- widgets ----
    list_widget_types: () => H().catalog(),
    list_widgets: () => H().instances(),
    spawn_widget: ({ type, cfg = {}, geometry } = {}) => {
      const id = H().addWidget(type, cfg);
      if (!id) throw new Error(`unknown widget type: ${type}`);
      if (geometry) P().setGeometry(id, geometry);
      return { id };
    },
    close_widget: ({ id } = {}) => { widgetById(id); H().removeWidget(id); return { id, closed: true }; },
    set_widget_config: ({ id, cfg = {} } = {}) => { widgetById(id); H().setConfig(id, cfg); return { id }; },
    set_widget_open: ({ id, open = true } = {}) => { widgetById(id); H().setOpen(id, !!open); return { id, open: !!open }; },
    move_widget: ({ id, x, y, w, h } = {}) => {
      widgetById(id);
      const ok = P().setGeometry(id, { x, y, w, h });
      return { id, moved: ok };
    },

    // ---- app-level ----
    get_state: async () => ({
      displays: await window.cockpit.listDisplays(),
      widgets: H().instances().length,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }),
    list_displays: () => window.cockpit.listDisplays(),
    set_display: ({ index } = {}) => { window.cockpit.setDisplay(index); return { index }; },
    set_clickthrough: ({ enabled = false } = {}) => { window.cockpit.setClickThrough(!!enabled); return { enabled: !!enabled }; },
    set_always_on_top: ({ enabled = false } = {}) => { window.cockpit.setAlwaysOnTop(!!enabled); return { enabled: !!enabled }; },

    // ---- settings (driven by the tray menu) ----
    get_settings: () => window.CockpitSettings.state(),
    toggle_bg_fill: () => ({ enabled: window.CockpitSettings.toggleBgFill() }),
    toggle_grid: () => ({ enabled: window.CockpitSettings.toggleGrid() }),
    toggle_snap: () => ({ enabled: window.CockpitSettings.toggleSnap() }),
    set_bg_color: ({ color } = {}) => ({ color: window.CockpitSettings.setBgColor(color) }),
    set_bg_alpha: ({ alpha } = {}) => ({ alpha: window.CockpitSettings.setBgAlpha(alpha) }),
    open_settings: ({ open = true } = {}) => ({ open: window.CockpitSettings.setPanelOpen(open) }),
    reset_layout: () => ({ ok: window.CockpitSettings.resetLayout() }),

    quit: () => { window.cockpit.quit(); return { quitting: true }; },
  };

  window.cockpit.control.onInvoke(async ({ id, method, params }) => {
    try {
      const fn = handlers[method];
      if (!fn) throw new Error(`unknown method: ${method}`);
      const result = await fn(params || {});
      window.cockpit.control.result({ id, ok: true, result });
    } catch (err) {
      window.cockpit.control.result({ id, ok: false, error: String((err && err.message) || err) });
    }
  });

  console.log('[control] renderer dispatcher ready');
})();
