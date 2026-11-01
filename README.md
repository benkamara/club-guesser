# Club Guesser

Players from one football club are revealed one at a time. Guess the club
whenever you like - or reveal another player for a better clue at a lower score.

```bash
npm start        # http://localhost:3000, uses the built-in dataset
npm test
```

## Scoring

`points = 1000 x difficulty x hintFactor x timeFactor x wrongFactor`

| Factor | Rule |
| --- | --- |
| Difficulty | Easy x1, Medium x1.5, Hard x2.5 |
| Hints | First player free, each extra keeps 80% (floor 20%) |
| Speed | Linear from 100% down to 40% over the difficulty's time limit (30/45/60s) |
| Wrong guesses | Each keeps 75%; 2 (easy) or 3 (medium/hard) ends the round at 0 |

Tuning lives in `src/scoring.js`.

## Difficulty

- **Easy** - 4 multiple-choice answers from elite clubs, most famous players first.
- **Medium** - type the club (any club), players in random order.
- **Hard** - type the club, least famous players first.

Each round's full hint list is built so it can only point at the target club,
so a determined player can always reach a certain answer.

## Using real Sportmonks data

```bash
SPORTMONKS_API_TOKEN=... SPORTMONKS_TEAM_IDS=19,18,9 npm run build-dataset
npm start   # picks up data/dataset.json automatically
```

`scripts/build-dataset.js` has not been run against a live token yet - verify the
include names against your Sportmonks plan. Sportmonks has no player "fame"
rating, which drives hint order and difficulty, so it defaults to 3; override per
player id in `data/fame-overrides.json` (`{ "<playerId>": 5 }`).

## Layout

- `src/scoring.js` - pure scoring, shared by server and browser preview
- `src/game.js` - round building and server-side round state (answer + clock stay on the server)
- `src/server.js` - dependency-free HTTP API + static files
- `src/data/mock.js` - built-in dataset (19 clubs, ~90 players)
