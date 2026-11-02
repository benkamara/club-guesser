import { DIFFICULTIES, calculateScore } from './scoring.js';

const MAX_HINTS = 6;      // players in the normal hint list
const MAX_EXTRA = 2;      // extra "disambiguator" players appended if needed
const MIN_POOL = 4;       // clubs with fewer known players are never targets
const ROUND_TTL_MS = 30 * 60 * 1000;

const shuffle = (arr, rng) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Order a club's players so the hint ramp matches the difficulty. */
export function orderHints(pool, difficulty, rng) {
  // Jitter keeps rounds varied while still honouring the fame ordering.
  const keyed = pool.map((p) => ({ p, k: p.fame + rng() * 1.5 }));
  if (difficulty === 'easy') keyed.sort((a, b) => b.k - a.k);       // stars first
  else if (difficulty === 'hard') keyed.sort((a, b) => a.k - b.k);  // obscure first
  else keyed.sort(() => rng() - 0.5);
  return keyed.map((x) => x.p);
}

/**
 * Take the first MAX_HINTS players, then append up to MAX_EXTRA players so that
 * the full list narrows to the target club (the only club all hints share).
 */
function buildHintList(ordered, targetId) {
  const list = ordered.slice(0, MAX_HINTS);
  const rest = ordered.slice(MAX_HINTS);
  const shared = () => {
    let s = new Set(list[0].clubs);
    for (const p of list) s = new Set(p.clubs.filter((c) => s.has(c)));
    s.delete(targetId);
    return [...s];
  };
  for (let n = 0; n < MAX_EXTRA; n++) {
    const rivals = shared();
    if (!rivals.length) break;
    const fix = rest.find((p) => rivals.some((r) => !p.clubs.includes(r)));
    if (!fix) break;
    list.push(fix);
    rest.splice(rest.indexOf(fix), 1);
  }
  return list;
}

export function createRound(dataset, difficulty, { rng = Math.random, exclude = [] } = {}) {
  const diff = DIFFICULTIES[difficulty];
  if (!diff) throw new Error(`Unknown difficulty: ${difficulty}`);

  const pools = new Map();
  for (const p of dataset.players) for (const c of p.clubs) {
    if (!pools.has(c)) pools.set(c, []);
    pools.get(c).push(p);
  }

  const eligible = dataset.clubs.filter((c) =>
    (pools.get(c.id)?.length ?? 0) >= MIN_POOL &&
    (difficulty !== 'easy' || c.tier === 1));
  let candidates = eligible.filter((c) => !exclude.includes(c.id));
  if (!candidates.length) candidates = eligible; // seen them all: start over
  if (!candidates.length) throw new Error('Dataset has no club with enough players');

  const target = candidates[Math.floor(rng() * candidates.length)];
  const hints = buildHintList(orderHints(pools.get(target.id), difficulty, rng), target.id);

  let options = null;
  if (diff.choices) {
    const decoys = shuffle(eligible.filter((c) => c.id !== target.id), rng).slice(0, diff.choices - 1);
    options = shuffle([target, ...decoys], rng).map(({ id, name }) => ({ id, name }));
  }

  return { target, hints, options, difficulty, maxHints: hints.length };
}

/**
 * Round state lives in a repo (Firestore in production, memory in tests) because
 * Cloud Functions instances are stateless. The answer and the clock never leave
 * the server: clients only ever see public hint data.
 *
 * repo.create(round) -> id
 * repo.update(id, fn) -> runs fn(round) atomically; fn returns { round, result }
 */
export class RoundStore {
  constructor(dataset, { repo = new MemoryRoundRepo(), now = () => Date.now(), rng = Math.random } = {}) {
    this.dataset = dataset;
    this.repo = repo;
    this.now = now;
    this.rng = rng;
  }

  async start(difficulty, exclude = []) {
    const round = createRound(this.dataset, difficulty, { rng: this.rng, exclude });
    const startedAt = this.now();
    const id = await this.repo.create({
      difficulty,
      target: round.target,
      hints: round.hints.map(publicPlayer),
      maxHints: round.maxHints,
      shown: 1,
      wrong: 0,
      done: false,
      startedAt,
      expireAt: new Date(startedAt + ROUND_TTL_MS), // Firestore TTL policy field
    });
    const d = DIFFICULTIES[difficulty];
    return {
      roundId: id,
      difficulty,
      timeLimit: d.timeLimit,
      maxHints: round.maxHints,
      maxWrong: d.maxWrong,
      options: round.options,
      hints: [publicPlayer(round.hints[0])],
    };
  }

  hint(id) {
    return this.repo.update(id, (r) => {
      assertOpen(r);
      if (r.shown >= r.maxHints) throw httpError(409, 'No more players to reveal');
      r.shown += 1;
      return { round: r, result: { hint: r.hints[r.shown - 1], shown: r.shown } };
    });
  }

  guess(id, clubId) {
    return this.repo.update(id, (r) => {
      assertOpen(r);
      const elapsed = (this.now() - r.startedAt) / 1000;
      if (clubId === r.target.id) {
        r.done = true;
        const score = calculateScore({
          difficulty: r.difficulty, hintsShown: r.shown, elapsedSeconds: elapsed, wrongGuesses: r.wrong,
        });
        return { round: r, result: { correct: true, done: true, answer: r.target, score, elapsed } };
      }
      r.wrong += 1;
      const max = DIFFICULTIES[r.difficulty].maxWrong;
      if (r.wrong >= max) {
        r.done = true;
        return { round: r, result: { correct: false, done: true, answer: r.target, wrong: r.wrong, score: zeroScore() } };
      }
      return { round: r, result: { correct: false, done: false, wrong: r.wrong, wrongLeft: max - r.wrong } };
    });
  }

  skip(id) {
    return this.repo.update(id, (r) => {
      assertOpen(r);
      r.done = true;
      return { round: r, result: { done: true, answer: r.target, score: zeroScore() } };
    });
  }
}

export class MemoryRoundRepo {
  constructor() { this.rounds = new Map(); this.nextId = 1; }
  async create(round) { const id = String(this.nextId++); this.rounds.set(id, round); return id; }
  async update(id, fn) {
    const current = this.rounds.get(id);
    if (!current) throw httpError(404, 'Unknown round');
    const { round, result } = fn(structuredClone(current));
    this.rounds.set(id, round);
    return result;
  }
}

function assertOpen(r) {
  if (r.done) throw httpError(409, 'Round already finished');
}

const zeroScore = () => ({ points: 0 });
const publicPlayer = (p) => ({ id: p.id, name: p.name, image: p.image ?? null });
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
