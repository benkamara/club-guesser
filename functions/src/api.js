import { DIFFICULTIES } from './scoring.js';
import { httpError } from './game.js';

/**
 * Transport-agnostic API: (method, path, body) -> { status, body }.
 * The Cloud Function adapts req/res to this, and tests call it directly.
 */
export function createApi(dataset, store) {
  const config = {
    source: dataset.source,
    difficulties: DIFFICULTIES,
    clubs: dataset.clubs.map(({ id, name }) => ({ id, name })),
  };

  async function route(method, path, body) {
    if (method === 'GET' && path === '/api/config') return config;
    if (method !== 'POST') throw httpError(404, 'Not found');

    if (path === '/api/rounds') {
      const { difficulty, exclude } = body;
      if (!DIFFICULTIES[difficulty]) throw httpError(400, 'Unknown difficulty');
      const ids = Array.isArray(exclude) ? exclude.filter((x) => typeof x === 'string').slice(0, 200) : [];
      return store.start(difficulty, ids);
    }
    const m = path.match(/^\/api\/rounds\/([^/]+)\/(hint|guess|skip)$/);
    if (!m) throw httpError(404, 'Not found');
    const [, id, action] = m;
    if (action === 'hint') return store.hint(id);
    if (action === 'skip') return store.skip(id);
    if (typeof body.clubId !== 'string') throw httpError(400, 'clubId required');
    return store.guess(id, body.clubId);
  }

  return async function handle(method, path, body = {}) {
    try {
      return { status: 200, body: await route(method, path, body ?? {}) };
    } catch (e) {
      if (!e.status) console.error(e);
      return { status: e.status ?? 500, body: { error: e.status ? e.message : 'Server error' } };
    }
  };
}
