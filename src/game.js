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

/** Server-side round state: the answer and the clock never leave the server. */
export class RoundStore {
  constructor(dataset, { now = () => Date.now(), rng = Math.random } = {}) {
    this.dataset = dataset;
    this.now = now;
    this.rng = rng;
    this.rounds = new Map();
    this.nextId = 1;
  }

  prune() {
    const cutoff = this.now() - ROUND_TTL_MS;
    for (const [id, r] of this.rounds) if (r.startedAt < cutoff) this.rounds.delete(id);
  }

  start(difficulty, exclude = []) {
    this.prune();
    const round = createRound(this.dataset, difficulty, { rng: this.rng, exclude });
    const id = String(this.nextId++);
    this.rounds.set(id, { ...round, shown: 1, wrong: 0, done: false, startedAt: this.now() });
    return {
      roundId: id,
      difficulty,
      timeLimit: DIFFICULTIES[difficulty].timeLimit,
      maxHints: round.maxHints,
      maxWrong: DIFFICULTIES[difficulty].maxWrong,
      options: round.options,
      hints: [publicPlayer(round.hints[0])],
    };
  }

  get(id) {
    const r = this.rounds.get(id);
    if (!r) throw httpError(404, 'Unknown round');
    if (r.done) throw httpError(409, 'Round already finished');
    return r;
  }

  hint(id) {
    const r = this.get(id);
    if (r.shown >= r.maxHints) throw httpError(409, 'No more players to reveal');
    r.shown += 1;
    return { hint: publicPlayer(r.hints[r.shown - 1]), shown: r.shown };
  }

  guess(id, clubId) {
    const r = this.get(id);
    const elapsed = (this.now() - r.startedAt) / 1000;
    if (clubId === r.target.id) {
      r.done = true;
      const score = calculateScore({
        difficulty: r.difficulty, hintsShown: r.shown, elapsedSeconds: elapsed, wrongGuesses: r.wrong,
      });
      return { correct: true, done: true, answer: r.target, score, elapsed };
    }
    r.wrong += 1;
    const max = DIFFICULTIES[r.difficulty].maxWrong;
    if (r.wrong >= max) {
      r.done = true;
      return { correct: false, done: true, answer: r.target, wrong: r.wrong, score: zeroScore() };
    }
    return { correct: false, done: false, wrong: r.wrong, wrongLeft: max - r.wrong };
  }

  skip(id) {
    const r = this.get(id);
    r.done = true;
    return { done: true, answer: r.target, score: zeroScore() };
  }
}

const zeroScore = () => ({ points: 0 });
const publicPlayer = (p) => ({ id: p.id, name: p.name, image: p.image ?? null });
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
