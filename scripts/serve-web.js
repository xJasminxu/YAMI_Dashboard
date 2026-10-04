// Minimaler statischer Webserver für den Produktions-Build (dist/), ohne Zusatzpakete.
// Läuft auf dem Restaurant-PC und liefert die App im WLAN aus:
//   node scripts/serve-web.js            -> Port 8080
//   PORT=3000 node scripts/serve-web.js  -> anderer Port
// Unbekannte Pfade ohne Dateiendung fallen auf index.html zurück (Single-Page-App).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('dist/index.html fehlt. Zuerst bauen: build-web.bat (bzw. npm run build:web)');
  process.exit(1);
}

function send(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  // Gehashte Bundles/Assets unter _expo/ und assets/ ändern sich nie -> lange cachen.
  // index.html & Co. immer frisch, damit ein neuer Build sofort auf allen Geräten ankommt.
  const rel = path.relative(ROOT, filePath).split(path.sep).join('/');
  const immutable = rel.startsWith('_expo/') || rel.startsWith('assets/');
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

http
  .createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isFile()) return send(res, filePath);
      if (!path.extname(urlPath)) return send(res, path.join(ROOT, 'index.html'));
      res.writeHead(404).end('Not found');
    });
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`YAMI Dashboard läuft auf Port ${PORT}:`);
    console.log(`  http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${PORT}`);
      }
    }
  });
