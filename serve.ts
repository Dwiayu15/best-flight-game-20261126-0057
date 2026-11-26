// A pocket static server so the game can be played while it is made:
//   node serve.ts          ->  http://localhost:8080
// It serves only the game/ folder beside this file, answers the handful
// of content types a browser game needs, and refuses any path that tries
// to climb out of game/. Nothing else clever lives here on purpose.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameDir = resolve(dirname(fileURLToPath(import.meta.url)), 'game');
const PORT = 8080;

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
]);

const server = createServer((req, res) => {
  // Strip the query string (the game uses ?seed= and ?shot= for staging,
  // which are read client-side and mean nothing to the server).
  const rawPath = (req.url ?? '/').split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400).end('bad path');
    return;
  }
  const wanted = decoded === '/' ? '/index.html' : decoded;
  const filePath = join(gameDir, normalize(wanted));

  // Stay inside game/: the resolved file must be the folder or under it.
  if (filePath !== gameDir && !filePath.startsWith(gameDir + sep)) {
    res.writeHead(403).end('outside the game folder');
    return;
  }

  let info;
  try {
    info = statSync(filePath);
  } catch {
    res.writeHead(404).end('no such file');
    return;
  }
  if (!info.isFile()) {
    res.writeHead(404).end('no such file');
    return;
  }

  res.writeHead(200, {
    'content-type': CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`serving ${gameDir} at http://localhost:${PORT}`);
});
