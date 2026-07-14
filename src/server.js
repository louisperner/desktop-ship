// Tiny local static server for the renderer.
//
// We deliberately serve the cockpit over http://127.0.0.1 instead of loading it
// from file://. YouTube (and other embed providers) reject iframes whose parent
// origin is file:// — that is the root cause of the "Error 153 / 152 video
// player configuration error". A real http origin makes the embed work without
// any header hacks.
//
// Local media widgets (image/video pointing at a path on disk) can no longer use
// file:// URLs once the page itself is http://, so we expose them through the
// /__local/ route, with HTTP range support so <video> seeking works.

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska', '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};

function mimeFor(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

// Stream a file with optional HTTP Range support (needed for <video> seeking).
function serveFile(filePath, req, res) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const type = mimeFor(filePath);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': type,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

// Start the server bound to loopback. A FIXED port is important: the page origin
// is http://127.0.0.1:<port>, and localStorage / IndexedDB are keyed by origin —
// an ephemeral port would give a fresh, empty store on every launch. If the fixed
// port is taken we fall back to an ephemeral one (persistence degrades, but the
// app still runs).
function startRendererServer(rendererDir, port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath;
      try { urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (_e) { res.writeHead(400); res.end('bad request'); return; }

      // Local file passthrough: /__local/<base64url of absolute path>
      if (urlPath.startsWith('/__local/')) {
        const b64 = urlPath.slice('/__local/'.length);
        let abs;
        try { abs = Buffer.from(b64, 'base64url').toString('utf8'); }
        catch (_e) { res.writeHead(400); res.end('bad path'); return; }
        if (!path.isAbsolute(abs)) { res.writeHead(400); res.end('not absolute'); return; }
        serveFile(abs, req, res);
        return;
      }

      // Static renderer assets. Resolve within rendererDir, no traversal.
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const root = path.normalize(rendererDir);
      const target = path.normalize(path.join(root, rel));
      if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
      serveFile(target, req, res);
    });
    const onErr = (err) => {
      if (port !== 0 && err.code === 'EADDRINUSE') {
        // Fixed port busy — retry on an ephemeral one so the app still launches.
        server.removeListener('error', onErr);
        server.listen(0, '127.0.0.1', onListen);
      } else { reject(err); }
    };
    function onListen() {
      const actual = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${actual}` });
    }
    server.on('error', onErr);
    server.listen(port, '127.0.0.1', onListen);
  });
}

module.exports = { startRendererServer };
