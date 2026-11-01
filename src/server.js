import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset } from './dataset.js';
import { RoundStore } from './game.js';
import { DIFFICULTIES } from './scoring.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const SCORING_FILE = fileURLToPath(new URL('./scoring.js', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export function createApp(dataset = loadDataset(), store = new RoundStore(dataset)) {
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const readBody = async (req) => {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 10_000) throw Object.assign(new Error('Body too large'), { status: 413 });
    }
    try { return raw ? JSON.parse(raw) : {}; }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  };

  async function handleApi(req, res, path) {
    if (req.method === 'GET' && path === '/api/config') {
      return json(res, 200, {
        source: dataset.source,
        difficulties: DIFFICULTIES,
        clubs: dataset.clubs.map(({ id, name }) => ({ id, name })),
      });
    }
    if (req.method === 'POST' && path === '/api/rounds') {
      const { difficulty, exclude = [] } = await readBody(req);
      if (!DIFFICULTIES[difficulty]) return json(res, 400, { error: 'Unknown difficulty' });
      return json(res, 200, store.start(difficulty, Array.isArray(exclude) ? exclude : []));
    }
    const m = path.match(/^\/api\/rounds\/([^/]+)\/(hint|guess|skip)$/);
    if (req.method === 'POST' && m) {
      const [, id, action] = m;
      if (action === 'hint') return json(res, 200, store.hint(id));
      if (action === 'skip') return json(res, 200, store.skip(id));
      const { clubId } = await readBody(req);
      if (typeof clubId !== 'string') return json(res, 400, { error: 'clubId required' });
      return json(res, 200, store.guess(id, clubId));
    }
    return json(res, 404, { error: 'Not found' });
  }

  async function handleStatic(res, path) {
    if (path === '/scoring.js') {
      res.writeHead(200, { 'content-type': TYPES['.js'] });
      return res.end(await readFile(SCORING_FILE));
    }
    const rel = normalize(path === '/' ? 'index.html' : path.slice(1));
    if (rel.startsWith('..')) { res.writeHead(403); return res.end(); }
    try {
      const data = await readFile(join(PUBLIC_DIR, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  }

  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path.startsWith('/api/')) await handleApi(req, res, path);
      else await handleStatic(res, path);
    } catch (e) {
      json(res, e.status ?? 500, { error: e.status ? e.message : 'Server error' });
      if (!e.status) console.error(e);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const ds = loadDataset();
  createApp(ds).listen(port, () =>
    console.log(`Club Guesser on http://localhost:${port} (data: ${ds.source}, ${ds.clubs.length} clubs, ${ds.players.length} players)`));
}
