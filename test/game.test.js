import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore } from '../src/scoring.js';
import { RoundStore, createRound } from '../src/game.js';
import { loadMockDataset } from '../src/data/mock.js';

const base = { difficulty: 'easy', hintsShown: 1, elapsedSeconds: 0, wrongGuesses: 0 };

test('instant first-player answer earns the full difficulty-scaled base', () => {
  assert.equal(calculateScore(base).points, 1000);
  assert.equal(calculateScore({ ...base, difficulty: 'hard' }).points, 2500);
});

test('each extra player reduces points, with a floor', () => {
  const p = (n) => calculateScore({ ...base, hintsShown: n }).points;
  assert.ok(p(1) > p(2) && p(2) > p(3));
  assert.equal(p(2), 800);
  assert.equal(p(50), 200);
});

test('slower answers earn less, never below the time floor', () => {
  const p = (s) => calculateScore({ ...base, elapsedSeconds: s }).points;
  assert.equal(p(15), 700);
  assert.equal(p(30), 400);
  assert.equal(p(999), 400);
});

test('wrong guesses reduce points', () => {
  assert.equal(calculateScore({ ...base, wrongGuesses: 1 }).points, 750);
});

test('every difficulty yields a valid round whose hints all played for the target', () => {
  const ds = loadMockDataset();
  for (const d of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 100; i++) {
      const r = createRound(ds, d);
      assert.ok(r.hints.length >= 4);
      assert.ok(r.hints.every((p) => p.clubs.includes(r.target.id)));
      assert.equal(new Set(r.hints.map((p) => p.id)).size, r.hints.length);
    }
  }
});

test('easy rounds offer 4 choices including the answer, only elite clubs', () => {
  const ds = loadMockDataset();
  for (let i = 0; i < 50; i++) {
    const r = createRound(ds, 'easy');
    assert.equal(r.options.length, 4);
    assert.ok(r.options.some((o) => o.id === r.target.id));
    assert.equal(r.target.tier, 1);
  }
});

test('full hint list never fits a second club when a disambiguator exists', () => {
  const ds = loadMockDataset();
  let ambiguous = 0;
  for (let i = 0; i < 200; i++) {
    const r = createRound(ds, 'medium');
    const shared = r.hints.reduce((s, p) => s.filter((c) => p.clubs.includes(c)), r.hints[0].clubs);
    if (shared.length > 1) ambiguous++;
  }
  assert.equal(ambiguous, 0);
});

test('store: answer is hidden until the round ends, and scoring uses server clock', () => {
  let t = 0;
  const store = new RoundStore(loadMockDataset(), { now: () => t });
  const start = store.start('medium');
  assert.equal(start.hints.length, 1);
  assert.equal(JSON.stringify(start).includes('target'), false);

  store.hint(start.roundId);
  const target = store.rounds.get(start.roundId).target.id;
  const wrongId = store.dataset.clubs.find((c) => c.id !== target).id;
  const w = store.guess(start.roundId, wrongId);
  assert.equal(w.correct, false);

  t = 15_000;
  const r = store.guess(start.roundId, target);
  // medium: 1000*1.5 * 0.8 (1 extra hint) * (1-15/45*0.6=0.8) * 0.75 (1 wrong)
  assert.equal(r.score.points, 720);
  assert.throws(() => store.guess(start.roundId, target), /finished/);
});

test('store: too many wrong guesses ends the round with 0 points', () => {
  const store = new RoundStore(loadMockDataset());
  const s = store.start('easy');
  const target = store.rounds.get(s.roundId).target.id;
  const wrongs = s.options.filter((o) => o.id !== target);
  store.guess(s.roundId, wrongs[0].id);
  const last = store.guess(s.roundId, wrongs[1].id);
  assert.equal(last.done, true);
  assert.equal(last.score.points, 0);
  assert.equal(last.answer.id, target);
});
