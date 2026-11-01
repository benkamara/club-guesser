// Builds data/dataset.json from the Sportmonks Football API (v3).
//
//   SPORTMONKS_API_TOKEN=... SPORTMONKS_TEAM_IDS=19,18,9 npm run build-dataset
//
// For each team id it pulls the squad, then each player's career teams, and
// keeps only clubs in your team list so "played for" links stay inside the game.
//
// NOTE: written against the v3 docs but NOT yet run against a live token.
// Check include names (`players.player`, `teams.team`) against your plan.
// Sportmonks has no "fame" field, so fame defaults to 3 and can be overridden
// per player id in data/fame-overrides.json, e.g. { "1234": 5 }.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATASET_PATH } from '../src/dataset.js';

const token = process.env.SPORTMONKS_API_TOKEN;
const teamIds = (process.env.SPORTMONKS_TEAM_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!token || !teamIds.length) {
  console.error('Set SPORTMONKS_API_TOKEN and SPORTMONKS_TEAM_IDS (comma separated team ids).');
  process.exit(1);
}

const BASE = 'https://api.sportmonks.com/v3/football';
const get = async (path, include) => {
  const url = `${BASE}${path}?include=${include}`;
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return (await res.json()).data;
};

const overridesPath = new URL('../data/fame-overrides.json', import.meta.url);
const fame = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};

const clubs = [];
const squads = new Map(); // playerId -> player
for (const id of teamIds) {
  const team = await get(`/teams/${id}`, 'players.player');
  clubs.push({ id: String(team.id), name: team.name, country: team.country_id ?? '', tier: 1 });
  for (const row of team.players ?? []) {
    if (row.player) squads.set(row.player.id, row.player);
  }
  console.log(`team ${team.name}: ${team.players?.length ?? 0} squad rows`);
}

const clubIds = new Set(clubs.map((c) => c.id));
const players = [];
for (const [pid, p] of squads) {
  const full = await get(`/players/${pid}`, 'teams.team');
  const memberOf = [...new Set((full.teams ?? []).map((t) => String(t.team_id)).filter((t) => clubIds.has(t)))];
  if (!memberOf.length) continue;
  players.push({
    id: String(pid),
    name: p.display_name ?? p.common_name ?? p.name,
    image: p.image_path ?? null,
    fame: fame[pid] ?? 3,
    clubs: memberOf,
  });
  await new Promise((r) => setTimeout(r, 150)); // be gentle with rate limits
}

mkdirSync(dirname(DATASET_PATH), { recursive: true });
writeFileSync(DATASET_PATH, JSON.stringify({ clubs, players }, null, 2));
console.log(`Wrote ${DATASET_PATH}: ${clubs.length} clubs, ${players.length} players`);
