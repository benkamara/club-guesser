import { calculateScore } from '/scoring.js';

const $ = (id) => document.getElementById(id);
const api = async (path, body) => {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data;
};

let config, round, total = 0, wrong = 0, ticker, seen = [], difficulty;

const show = (name) => { for (const s of ['menu', 'game', 'result']) $(s).hidden = s !== name; };

function addPlayer(p) {
  const li = document.createElement('li');
  if (p.image) { const img = document.createElement('img'); img.src = p.image; img.alt = ''; li.append(img); }
  li.append(p.name);
  $('players').append(li);
}

function refreshWorth() {
  const elapsed = (Date.now() - round.startedAt) / 1000;
  $('timer').textContent = Math.floor(elapsed);
  $('worth').textContent = calculateScore({
    difficulty, hintsShown: round.shown, elapsedSeconds: elapsed, wrongGuesses: wrong,
  }).points;
  $('reveal').disabled = round.shown >= round.maxHints;
  $('reveal').textContent = round.shown >= round.maxHints ? 'No more players' : 'Reveal another player (-20%)';
}

async function startRound() {
  clearInterval(ticker);
  wrong = 0;
  $('message').textContent = '';
  $('players').replaceChildren();
  const data = await api('/api/rounds', { difficulty, exclude: seen });
  round = { ...data, shown: 1, startedAt: Date.now() };
  data.hints.forEach(addPlayer);
  $('diff-label').textContent = config.difficulties[difficulty].label;

  $('choices').hidden = !data.options;
  $('search-form').hidden = !!data.options;
  $('choices').replaceChildren(...(data.options ?? []).map((o) => {
    const b = document.createElement('button');
    b.textContent = o.name; b.onclick = () => guess(o.id); return b;
  }));
  $('club-input').value = '';
  show('game');
  refreshWorth();
  ticker = setInterval(refreshWorth, 250);
}

async function guess(clubId) {
  try {
    const r = await api(`/api/rounds/${round.roundId}/guess`, { clubId });
    if (r.done) return finish(r);
    wrong = r.wrong;
    $('message').textContent = `Not that one - ${r.wrongLeft} guess${r.wrongLeft === 1 ? '' : 'es'} left.`;
    refreshWorth();
  } catch (e) { $('message').textContent = e.message; }
}

function finish(r) {
  clearInterval(ticker);
  seen.push(r.answer.id);
  total += r.score.points;
  $('total').textContent = total;
  $('result-title').textContent = r.correct ? `Correct! +${r.score.points}` : 'Out of luck';
  $('result-detail').textContent = r.correct
    ? `${r.answer.name} - ${round.shown} player${round.shown === 1 ? '' : 's'}, ${r.elapsed.toFixed(1)}s, ${wrong} wrong.`
    : `It was ${r.answer.name}.`;
  show('result');
}

$('reveal').onclick = async () => {
  try {
    const r = await api(`/api/rounds/${round.roundId}/hint`, {});
    round.shown = r.shown; addPlayer(r.hint); refreshWorth();
  } catch (e) { $('message').textContent = e.message; }
};
$('give-up').onclick = async () => finish(await api(`/api/rounds/${round.roundId}/skip`, {}));
$('next').onclick = startRound;
$('quit').onclick = () => { seen = []; show('menu'); };
$('search-form').onsubmit = (e) => {
  e.preventDefault();
  const name = $('club-input').value.trim().toLowerCase();
  const club = config.clubs.find((c) => c.name.toLowerCase() === name);
  if (!club) { $('message').textContent = 'Pick a club from the suggestions.'; return; }
  $('club-input').value = '';
  guess(club.id);
};

config = await api('/api/config');
$('source').textContent = `Data: ${config.source}`;
$('club-list').replaceChildren(...config.clubs.map((c) => Object.assign(document.createElement('option'), { value: c.name })));
const blurb = { easy: '4 choices, famous players first', medium: 'type the club, mixed players', hard: 'type the club, obscure players first' };
for (const [key, d] of Object.entries(config.difficulties)) {
  const b = document.createElement('button');
  b.innerHTML = `${d.label} <small>x${d.multiplier} points - ${d.timeLimit}s - ${blurb[key]}</small>`;
  b.onclick = () => { difficulty = key; seen = []; startRound(); };
  $('difficulty-buttons').append(b);
}
