# Club Guesser

Players from one football club are revealed one at a time. Guess the club
whenever you like - or reveal another player for a better clue at a lower score.

Runs on Firebase: **Hosting** serves `public/`, a **Cloud Function** (`api`) runs
the game logic, and **Firestore** holds in-progress rounds.

## Deploy

One-time setup:

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # pick your project (creates .firebaserc)
npm --prefix functions install
```

In the Firebase console: upgrade to the **Blaze** plan (required for Cloud
Functions) and create a **Firestore database** (production mode - the rules in
`firestore.rules` deny all client access, which is what we want).

Then:

```bash
firebase deploy
```

Optional but recommended: add a Firestore **TTL policy** on collection group
`rounds`, field `expireAt`, so abandoned rounds delete themselves after 30 minutes
(Console > Firestore > Time-to-live).

## How it fits together

- `public/` - the browser UI (static).
- `functions/index.js` - the `api` function; Hosting rewrites `/api/**` to it.
- `functions/src/game.js` - round building and scoring flow. Rounds are stored in
  Firestore (`rounds/{id}`) including the answer and start time, so the client
  can never see the answer early or fake its speed.
- `functions/src/scoring.js` - pure scoring. A copy lives at `public/scoring.js`
  for the live "points available" display; `npm run sync-scoring` refreshes it
  (also runs automatically before a Hosting deploy, and a test fails if they drift).
- `functions/src/data/mock.js` - built-in dataset (19 clubs, ~90 players).

## Scoring

`points = 1000 x difficulty x hintFactor x timeFactor x wrongFactor`

| Factor | Rule |
| --- | --- |
| Difficulty | Easy x1, Medium x1.5, Hard x2.5 |
| Hints | First player free, each extra keeps 80% (floor 20%) |
| Speed | Linear from 100% down to 40% over the difficulty's time limit (30/45/60s) |
| Wrong guesses | Each keeps 75%; 2 (easy) or 3 (medium/hard) ends the round at 0 |

Tuning lives in `functions/src/scoring.js`.

## Difficulty

- **Easy** - 4 multiple-choice answers from elite clubs, most famous players first.
- **Medium** - type the club (any club), players in random order.
- **Hard** - type the club, least famous players first.

## Using real Sportmonks data

The Sportmonks token is only needed on your machine, once, to build a dataset
file that ships with the function - the live game makes no Sportmonks calls.

```bash
SPORTMONKS_API_TOKEN=... SPORTMONKS_TEAM_IDS=19,18,9 npm run build-dataset
firebase deploy --only functions   # functions/data/dataset.json is picked up automatically
```

`scripts/build-dataset.js` has not been run against a live token yet - verify the
include names against your Sportmonks plan. Sportmonks has no player "fame"
rating, which drives hint order and difficulty, so it defaults to 3; override per
player id in `functions/data/fame-overrides.json` (`{ "<playerId>": 5 }`).

## Tests

```bash
npm test
```
