#!/usr/bin/env node
// ============================================================================
// Desktop Ship — MCP server.
//
// A stdio MCP server that any client (Claude Code/Desktop, LocalMind, …) can
// register. It bridges MCP tool calls to the running cockpit's WebSocket
// control server. Connection details are discovered from the handshake file
// the app writes on launch (~/.desktopship/control.json) — no manual config.
//
// Register it, e.g. in Claude's mcp config:
//   { "mcpServers": { "desktop-ship": { "command": "node",
//       "args": ["/Applications/Desktop Ship.app/Contents/Resources/mcp/server.cjs"] } } }
// ============================================================================
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const WebSocket = require('ws');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HANDSHAKE = path.join(os.homedir(), '.desktopship', 'control.json');

// ---- WebSocket control client (lazy, auto-reconnect per request) -----------
let ws = null;
let seq = 0;
const pending = new Map();

function readHandshake() {
  try {
    return JSON.parse(fs.readFileSync(HANDSHAKE, 'utf8'));
  } catch {
    throw new Error(
      'Desktop Ship is not running (no handshake at ~/.desktopship/control.json). Launch the app first.',
    );
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve(ws);
    const { port, token } = readHandshake();
    const sock = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`);
    sock.on('open', () => { ws = sock; resolve(sock); });
    sock.on('error', (err) => reject(new Error(`cannot reach cockpit: ${err.message}`)));
    sock.on('close', () => { if (ws === sock) ws = null; });
    sock.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'cockpit error'));
    });
  });
}

async function call(method, params = {}) {
  const sock = await connect();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sock.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
    }, 12000);
  });
}

// Wrap a control result as MCP tool output (text content with pretty JSON).
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: String((err && err.message) || err) }] });
const run = (method, params) => call(method, params).then(ok).catch(fail);

// ---- MCP server + tools ----------------------------------------------------
const server = new McpServer({ name: 'desktop-ship', version: '0.1.0' });

server.registerTool('cockpit_status', {
  title: 'Cockpit status',
  description: 'Get the cockpit state: connected displays, viewport size and widget count.',
  inputSchema: {},
}, () => run('get_state'));

server.registerTool('list_widget_types', {
  title: 'List widget types',
  description: 'List every widget type that can be spawned, with its config fields.',
  inputSchema: {},
}, () => run('list_widget_types'));

server.registerTool('list_widgets', {
  title: 'List widgets',
  description: 'List the widgets currently on the cockpit (id, type, config, open state).',
  inputSchema: {},
}, () => run('list_widgets'));

server.registerTool('spawn_widget', {
  title: 'Spawn widget',
  description:
    'Add a widget to the cockpit. type is one of the catalog types (clock, sys, map, ship, log, todo, image, video, folder, gmap, spotify, camera). cfg holds type-specific config (e.g. {src} for image/video, {q} for gmap, {uri} for spotify, {path} for folder). Optional geometry positions it.',
  inputSchema: {
    type: z.string().describe('widget type from the catalog'),
    cfg: z.record(z.any()).optional().describe('type-specific config object'),
    geometry: z
      .object({ x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional() })
      .optional()
      .describe('initial position/size in pixels'),
  },
}, ({ type, cfg, geometry }) => run('spawn_widget', { type, cfg, geometry }));

server.registerTool('close_widget', {
  title: 'Close widget',
  description: 'Remove a widget from the cockpit by id.',
  inputSchema: { id: z.string().describe('widget id (from list_widgets)') },
}, ({ id }) => run('close_widget', { id }));

server.registerTool('set_widget_config', {
  title: 'Configure widget',
  description: 'Update a widget\'s config (e.g. change an image src or map query). cfg is merged.',
  inputSchema: { id: z.string(), cfg: z.record(z.any()).describe('config fields to merge') },
}, ({ id, cfg }) => run('set_widget_config', { id, cfg }));

server.registerTool('set_widget_open', {
  title: 'Show/hide widget',
  description: 'Open (show) or close (hide) a widget without removing it.',
  inputSchema: { id: z.string(), open: z.boolean() },
}, ({ id, open }) => run('set_widget_open', { id, open }));

server.registerTool('move_widget', {
  title: 'Move/resize widget',
  description: 'Reposition and/or resize a widget. Any of x, y, w, h (pixels) may be given.',
  inputSchema: {
    id: z.string(),
    x: z.number().optional(), y: z.number().optional(),
    w: z.number().optional(), h: z.number().optional(),
  },
}, ({ id, x, y, w, h }) => run('move_widget', { id, x, y, w, h }));

server.registerTool('set_display', {
  title: 'Move cockpit to display',
  description: 'Move the cockpit to a given monitor index (see cockpit_status for the list).',
  inputSchema: { index: z.number().int() },
}, ({ index }) => run('set_display', { index }));

server.registerTool('set_clickthrough', {
  title: 'Toggle click-through',
  description: 'When enabled, mouse clicks pass through the cockpit to the apps below.',
  inputSchema: { enabled: z.boolean() },
}, ({ enabled }) => run('set_clickthrough', { enabled }));

server.registerTool('set_always_on_top', {
  title: 'Toggle always-on-top',
  description: 'Pin the cockpit above all other windows, or drop it behind them.',
  inputSchema: { enabled: z.boolean() },
}, ({ enabled }) => run('set_always_on_top', { enabled }));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[desktop-ship mcp] ready (stdio)');
}

main().catch((err) => {
  console.error('[desktop-ship mcp] fatal:', err);
  process.exit(1);
});
