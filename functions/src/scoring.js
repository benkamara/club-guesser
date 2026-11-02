// Pure scoring logic. Shared by the server (authoritative) and the browser
// (live "points available" preview), so keep it dependency-free.

export const BASE_POINTS = 1000;

export const DIFFICULTIES = {
  easy:   { label: 'Easy',   multiplier: 1,   timeLimit: 30, maxWrong: 2, choices: 4 },
  medium: { label: 'Medium', multiplier: 1.5, timeLimit: 45, maxWrong: 3, choices: 0 },
  hard:   { label: 'Hard',   multiplier: 2.5, timeLimit: 60, maxWrong: 3, choices: 0 },
};

export const HINT_FACTOR = 0.8;   // each extra player revealed (after the first) keeps 80%
export const HINT_FLOOR = 0.2;
export const TIME_FLOOR = 0.4;    // speed can never cost more than 60%
export const WRONG_FACTOR = 0.75; // each wrong guess keeps 75%

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Points available right now for a correct answer.
 * hintsShown includes the first (free) player.
 */
export function calculateScore({ difficulty, hintsShown, elapsedSeconds, wrongGuesses = 0 }) {
  const d = DIFFICULTIES[difficulty];
  if (!d) throw new Error(`Unknown difficulty: ${difficulty}`);

  const extraHints = Math.max(0, hintsShown - 1);
  const hintFactor = Math.max(HINT_FLOOR, HINT_FACTOR ** extraHints);
  const timeFactor = clamp(1 - (elapsedSeconds / d.timeLimit) * (1 - TIME_FLOOR), TIME_FLOOR, 1);
  const wrongFactor = WRONG_FACTOR ** wrongGuesses;

  const points = Math.round(BASE_POINTS * d.multiplier * hintFactor * timeFactor * wrongFactor);
  return { points, hintFactor, timeFactor, wrongFactor, multiplier: d.multiplier };
}
