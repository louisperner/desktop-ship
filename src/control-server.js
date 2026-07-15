// ============================================================================
// Control server — a tiny WebSocket bridge that lets external processes drive
// the cockpit. The MCP server (src/mcp/server.js) connects here as a client.
//
// Protocol (JSON per message):
//   client → server : { id, method, params }
//   server → client : { id, ok: true, result } | { id, ok: false, error }
//
// Auth: the client must connect to ws://127.0.0.1:<port>?token=<token>. Both
// the port and token are published to a stable handshake file so a sibling
// process can discover them without configuration:
//   ~/.desktopship/control.json  ->  { port, token, pid }
//
// Every method is forwarded to the renderer (which owns CockpitHolos and the
// rest of the UI) over IPC and the renderer's reply is sent back to the client.
// ============================================================================
const { WebSocketServer } = require('ws');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const PREFERRED_PORT = Number(process.env.DESKTOPSHIP_CONTROL_PORT) || 8788;

function handshakePath() {
  const dir = path.join(os.homedir(), '.desktopship');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'control.json');
}

// Start the control server. `invokeRenderer(method, params)` must return a
// promise resolving with the renderer's result (or rejecting on error).
function startControlServer(invokeRenderer) {
  const token = crypto.randomBytes(24).toString('hex');

  const wss = new WebSocketServer({ host: '127.0.0.1', port: PREFERRED_PORT }, () => {
    const { port } = wss.address();
    const file = handshakePath();
    // 0600: the token grants full control of the cockpit, so keep it readable
    // only by the current user.
    fs.writeFileSync(file, JSON.stringify({ port, token, pid: process.pid }, null, 2), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch (_e) {}
    console.log(`[control] listening on ws://127.0.0.1:${port} (handshake: ${file})`);
  });

  wss.on('error', (err) => console.error(`[control] server error: ${err.message}`));

  wss.on('connection', (ws, req) => {
    // Token check (query string) — reject unauthenticated clients outright.
    // Constant-time compare so the token can't be recovered by timing.
    const url = new URL(req.url, 'http://127.0.0.1');
    const given = Buffer.from(String(url.searchParams.get('token') || ''));
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      ws.close(4001, 'unauthorized');
      return;
    }
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const { id, method, params } = msg || {};
      if (id == null || !method) return;
      try {
        const result = await invokeRenderer(method, params || {});
        ws.send(JSON.stringify({ id, ok: true, result }));
      } catch (err) {
        ws.send(JSON.stringify({ id, ok: false, error: String((err && err.message) || err) }));
      }
    });
  });

  return {
    close() {
      try { fs.unlinkSync(handshakePath()); } catch {}
      wss.close();
    },
  };
}

module.exports = { startControlServer, handshakePath };
