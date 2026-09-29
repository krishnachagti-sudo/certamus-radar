# Certamus Radar

Open case competitions at IITs, IIMs, top B-schools, flagship corporates and
the international circuit, checked against the Certamus team (four IIM
Sirmaur BMS students, graduating 2029).
Board: https://krishnachagti-sudo.github.io/certamus-radar/

## Pages

- **Board** (`index.html`) — top hosts only (IIT / IIM / B-school /
  Corporate / International), case competitions only. Edit statuses here,
  add an Unstop link by hand.
- **All case comps** (`all.html`) — every host and tier, including Other and
  startup contests (labelled "Startup contest, not a case"), with a text
  search over title and host.
- **Competition** (`c.html?id=<id>`) — one competition: eligibility rule by
  rule, dates, team notes, status, the **Registered ✓** tick, clash
  warnings, and (for international records) the entry route, who applies,
  and a "Set dates" form.
- **Calendar** (`calendar.html`) — a month grid with an Agenda toggle
  (Agenda is the default under 760px). Shows anything Watching, Entering or
  Registered, plus dashed "expected" markers for curated international
  competitions with no confirmed dates yet.
- **Hosts & archive** (`hosts.html`) — every host seen (live, archived and
  curated international), searchable and tier-filterable, with a Jan–Dec
  month strip and the latest title; and a searchable list of closed
  competitions, newest first.

A shared nav appears on all five pages.

## Registered ✓

Independent of Watching / Entering / Skipped: a competition can be marked
**Registered** with any status, or none. Toggle it from a card (edit mode)
or the Competition page panel. The "committed" set used for clash checking,
the digest and the calendar is *Entering OR Registered* — so a competition
you've registered for still shows clashes even if its status is Watching.
The Board's status filter has a separate "Registered only" toggle.

## International competitions

Unstop has no international hosts, so the International tier is built from
two sources:

- **A curated list** (`data/international.json`, hand-edited): 25 flagship
  competitions verified from their official pages. Of these, about 5 are
  open for the team to enter directly (ICBC, CBS GLOBAL, GCCH, 180DC,
  Brandstorm); most of the rest (JMUCC, MICC, RSM, AUBCC and others) require
  **IIM Sirmaur itself** to apply for an invitation — the card says which
  applies. A row with `verified: false` is hidden until someone confirms it
  from the official page.
- **Opportunity Desk** (`fetch/oppdesk.js`), an automated daily feed from
  Opportunity Desk's WordPress API: posts whose title reads as a case
  competition, with the deadline parsed out of the post body. Low volume by
  design (a handful of posts a year clear the filter); a fetch failure here
  is a warning, not a failed run.

### Weekly official-page watcher

A weekly Action (`fetch/watch.js`, Mondays 05:00 IST, before the Sunday-
night digest) fetches each curated competition's official watch page,
strips it down to text and hashes it. A changed hash shows **"Official page
changed on \<date>, new edition?"** on the card and in the digest — a
prompt to go check the page by hand, not an automatic date update.

To confirm real dates once you've checked a page: open the competition on
`c.html`, use **Set dates** (edit mode) to enter the registration close and
competition end. That writes the `intl_dates` table in Supabase; the
Competition page shows the dates at once, and the calendar, board and clash
checks pick them up after the next fetch (the page says so when you save).

## Archive

Closed competitions are appended to `data/archive.json` when `fetch/run.js`
prunes them out of the live file (60 days after they close, or 60 days
after a committed team ends up entering/registering). Curated international
entries never get pruned as *hosts* — only a specific edition's confirmed
dates close, so it archives by `id@regn_close`, one entry per edition. The
Hosts & archive page lists it, newest first, searchable; while it holds
under 30 days of history it says so plainly rather than looking empty by
mistake.

- **Daily 06:00 IST** `fetch` workflow → `data/competitions.json`,
  `data/status.json`, `data/archive.json`.
- **Monday 05:00 IST** `watch` workflow → `data/watch.json`.
- **Monday 08:00 IST** `digest` workflow → email; `data/digest-state.json`.
- **Board / Competition** edits (Watching / Entering / Skipped, Registered,
  notes, add an Unstop link, Set dates) write the Supabase tables
  `decisions`, `manual` and `intl_dates` (see "Editing" below).
  The board has a "Quizzes and other formats" toggle: records carry
  `is_case`, and quizzes, article calls and coding challenges are hidden by
  default and never appear in the digest.

Each piece of data has exactly one writer, so the jobs and the board never
conflict:

| Data | Written by |
|---|---|
| `data/competitions.json`, `data/status.json` | `fetch/run.js` |
| `data/archive.json` | `fetch/run.js` |
| `data/watch.json` | `fetch/watch.js` |
| Supabase `decisions` (status, Registered, note) | the board, All case comps and Competition pages (edit link) |
| Supabase `manual` (hand-added Unstop links) | the board's Add form (edit link) |
| Supabase `intl_dates` (confirmed international dates) | the Competition page's "Set dates" (edit link) |
| `data/international.json` | hand-edited only; nothing writes it |
| `data/digest-state.json` | the digest job |

The fetch and digest jobs only read the Supabase tables. If Supabase is
not configured or a read fails, they carry on with a warning: decisions and
links fall back to the old `data/decisions.json` / `data/manual.json` if
present (they are retired, so normally none), curated international records
keep yesterday's dates, and the digest puts a warning line at the top.

Listing body text is used to classify each competition but is never stored
or published: it often carries organisers' personal phone numbers and
emails.

## Setup (once)

1. Monday email: the `digest` workflow (Mon 08:00 IST) publishes the digest
   to `data/digest-latest.json`; a weekly Claude scheduled task (Mon 08:30
   IST, on the owner's Mac) reads it and sends it from the owner's Gmail via
   the Gmail connector. No mail credentials live in the repo. (Fallback:
   `node digest/email.js --send` with `GMAIL_USER` / `GMAIL_APP_PASSWORD`
   still works if SMTP is ever preferred.)
2. Pages: Settings → Pages → Build and deployment → **Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. Editing: see below.

## Editing (private edit link)

Only the owner edits, with no login. Everyone can read the team's
decisions; a secret **editor key** unlocks editing on a device.

1. Create a Supabase project (free tier). In its SQL Editor, run
   `supabase/schema.sql` once. It creates the three tables (public read, no
   direct writes) and the write functions `set_decision`, `add_manual` and
   `set_intl_dates`, which refuse any call without the right key.
2. Put the project's URL and anon (public) key in `config.js` and commit.
   Until both are filled in, the site is read-only with a quiet "Editing not
   configured yet" banner, and the jobs fall back as described above.
3. Keep the private link
   `https://krishnachagti-sudo.github.io/certamus-radar/#key=<your 64-hex key>`
   somewhere safe (a password manager). Open it once on each device you
   edit from: the page moves the key into that browser's storage, removes it
   from the address bar, and checks it with the server. A wrong key shows
   "That edit link isn't valid". **Stop editing on this device** (footer)
   forgets it.

The key itself is never in the repo. Only its SHA-256 is, in
`supabase/schema.sql` (the `private.editor_key` table); the server hashes
whatever key a page sends and compares.

To rotate the key (lost device, link shared by mistake):

```bash
KEY=$(openssl rand -hex 32); echo "$KEY"             # the new key: keep it
printf %s "$KEY" | shasum -a 256 | cut -d' ' -f1   # its hash
```

then in the Supabase SQL Editor:
`update private.editor_key set hash = '<new hash>';`
(and update the hash in `supabase/schema.sql` so a rebuild matches). Every
device holding the old key gets "edit link was rejected" on its next save
and drops back to read-only; open the new link on the devices you keep.

Free-tier note: Supabase pauses a free project after about a week without
activity. The daily fetch reads the tables, which should keep it awake, but
if the board shows "Could not load team data" or the fetch status warns
about Supabase, open the Supabase dashboard and restore the project. While
it is paused the site still works read-only and the jobs carry on with
their fallbacks.

## Tuning

`data/team.json` (size, graduating years), `data/keywords.json` (search
terms), `data/bschools.json` and `data/corporates.json` (regexes that decide
the tier), `data/international.json` (the curated international list, hand-
edited). Edit, commit, and the next fetch applies them. `fetch/unstop.js`'s
`is_case` rule decides what counts as a case competition.

## Develop

```bash
npm test            # unit tests
npm run fetch       # live fetch into data/
npm run digest      # print the digest without sending
node fetch/watch.js # live watcher run (checks every curated official page)
```

If the digest's final push fails, `data/digest-state.json` isn't updated and
next week's digest may repeat items.

Unstop's API is undocumented. If the board shows "Data stale", open the
failed `fetch` run: a shape change means `fetch/unstop.js` needs updating.

After a deploy, GitHub Pages can serve a page's old JS modules for a few
minutes even once the new ones are live (observed up to about 10 minutes).
If a page looks stale right after a push, hard-refresh
(cmd/ctrl+shift+R) before assuming something's broken.
