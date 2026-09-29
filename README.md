# Certamus Radar

Open case competitions at IITs, IIMs, top B-schools and flagship corporates,
from Unstop, checked against the Certamus team (four IIM Sirmaur BMS students,
graduating 2029). Board: https://krishnachagti-sudo.github.io/certamus-radar/

- **Daily 06:00 IST** `fetch` workflow → `data/competitions.json`, `data/status.json`.
- **Monday 08:00 IST** `digest` workflow → email; `data/digest-state.json`.
- **Board** edits (Watching / Entering / Skipped, notes, add an Unstop link)
  write `data/decisions.json` and `data/manual.json` through the GitHub API.
  The board has a "Quizzes and other formats" toggle: records carry `is_case`,
  and quizzes, article calls and coding challenges are hidden by default and
  never appear in the digest.

Each data file has one writer, so the jobs and the board never conflict.

## Setup (once)

1. Repo secrets (Settings → Secrets and variables → Actions):
   `GMAIL_USER` (the sending Gmail address), `GMAIL_APP_PASSWORD`
   (Google Account → Security → App passwords), optional `DIGEST_TO`
   (defaults to `GMAIL_USER`).
2. Board editing: create a fine-grained token (GitHub → Settings → Developer
   settings → Fine-grained tokens), repository access **certamus-radar only**,
   permission **Contents: Read and write**. On the board, press **Edit** and
   paste it. It is stored only in that browser; **Lock editing** removes it.

## Tuning

`data/team.json` (size, graduating years), `data/keywords.json` (search
terms), `data/bschools.json` and `data/corporates.json` (regexes that decide
the tier). Edit, commit, and the next fetch applies them. `fetch/unstop.js`'s
`is_case` rule decides what counts as a case competition.

## Develop

```bash
npm test            # unit tests
npm run fetch       # live fetch into data/
npm run digest      # print the digest without sending
```

Unstop's API is undocumented. If the board shows "Data stale", open the
failed `fetch` run: a shape change means `fetch/unstop.js` needs updating.
