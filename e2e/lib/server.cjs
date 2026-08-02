// =====================================================
// Static server for the exported web bundle (dist/).
// No external server, no network dependency: the harness
// owns the process it talks to, so a failed run can never
// be blamed on "something else was serving stale files".
// SPA fallback: unknown paths return index.html.
// =====================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serve `distDir` on `port`. Resolves to { url, close() }.
 * port 0 lets the OS pick a free one, so parallel runs never collide.
 */
async function serveDist(distDir, port = 0) {
  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) {
    throw new Error(
      `No web bundle at ${distDir}. Build it first:\n` +
      `    npx expo export --platform web`
    );
  }

  /**
   * Stream a file, surviving the file vanishing or being locked mid-read.
   * That is not hypothetical: `expo export` deletes and rewrites dist/ while
   * a tour is running, and an unhandled stream 'error' takes the whole
   * harness process down with EPERM/ENOENT. A dead request is recoverable;
   * a dead runner loses the entire matrix.
   */
  const send = (res, file, status = 200) => {
    let stream;
    try {
      stream = fs.createReadStream(file);
    } catch (e) {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end(`e2e static server: cannot read ${path.basename(file)} (${e.code || e.message})`);
      return;
    }
    stream.on('error', (e) => {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end(`e2e static server: read failed for ${path.basename(file)} (${e.code || e.message})`);
      stream.destroy();
    });
    res.writeHead(status, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    stream.pipe(res);
  };

  const server = http.createServer((req, res) => {
    res.on('error', () => { /* client went away mid-response */ });
    let rel;
    try {
      rel = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      rel = '/';
    }
    if (rel === '/') rel = '/index.html';

    // Never let a crafted path escape dist/.
    const target = path.resolve(distDir, '.' + rel);
    const inside = target === path.resolve(distDir) || target.startsWith(path.resolve(distDir) + path.sep);

    let isFile = false;
    try {
      isFile = inside && fs.statSync(target).isFile();
    } catch { /* missing / racing with a rebuild — fall through to the SPA index */ }

    send(res, isFile ? target : index);
  });

  // A socket error must never become an unhandled 'error' event either.
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const actual = server.address().port;
  return {
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

module.exports = { serveDist };
