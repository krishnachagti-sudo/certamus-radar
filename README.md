# Certamus Radar

Open case competitions and business events at IITs, IIMs, NITs / IIITs and
other national institutes, top B-schools and colleges, flagship corporates and
the international circuit, checked against the Certamus team (four IIM
Sirmaur BMS students, graduating 2029).
Board: https://conyso.com/certamus/radar/ (team members only, Google sign-in).
The radar itself is Krishna's (the admin); teammates get one screen, the
teams they are in to join (see "Sign-in and roles").

## Pages

- **Board** (`index.html`) — top hosts only (IIT / IIM / NIT, IIIT and
  national institutes / B-school and top college / Corporate /
  International), case competitions and business events only (see "What
  gets fetched" below). The admin edits statuses here and adds Unstop links
  by hand.
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
- **Team** (`team.html`) — for the admin, who is still to join and every
  team's rounds; for a teammate, their whole view of the site (see "Teams,
  invite links and rounds" below).
- **Hosts & archive** (`hosts.html`) — every host seen (live, archived,
  curated international and fest watchlist), searchable and tier-filterable, with a Jan–Dec
  month strip and the latest title; and a searchable list of closed
  competitions, newest first.

A shared nav appears on all six pages for the admin. Teammates see only
the Team page, with no nav.

### Sections: Case comps | Hackathons

The nav starts with a two-way switch, **Case comps | Hackathons**
(`aria-current` on the active one). Every page takes the section from a
`?s=hack` query parameter; without it the page shows case comps exactly as
before. Switching keeps the page (Board ↔ Board, Calendar ↔ Calendar; the
competition page switches to the other Board), and every internal link
(nav, card titles, inbox rows, calendar events, host and archive rows)
carries the section. A competition link that lost its `s=hack` still opens
as a hackathon when its id starts `df-`, `mlh-`, `dp-` or `hk-`
(`lib/section.js` holds the data files, wording, tiers, rule table and link
builder for each section).

The Hackathons side has the same pages over `hackathons.json`,
`hack-status.json`, `hack-archive.json` and `hack-curated.json`:

- **Cards** show a kind chip (**Build** or **Ideathon**), where it happens
  ("Online", the city, or the country), the team size from
  `team_min`/`team_max`, and the source link: "Open on Unstop / Devfolio /
  Devpost", "Open on MLH" (or "Official site (listed on MLH)" when MLH
  links to the event's own site), "Official site" for curated rows.
- **Board tiers:** IIT, IIM, national institutes, B-school, Corporate and
  **Global online & abroad**; All adds Other.
- **Other formats** (off by default): coding contests, CTFs, datathons,
  quizzes and other `hack_kind: 'other'` records, like case comps'
  "Quizzes and other formats".
- **Include in-person abroad** (off by default, Board and All): hides
  in-person and hybrid events outside India (mostly MLH and Devpost in the
  US and Canada). Online events and events in India always show. The count
  line says how many it hides.
- **Duplicates across sources** (display only): an event listed on more
  than one source (Devfolio and MLH, Unstop and Devpost...) shows once when
  the titles match after dropping case, punctuation, years and edition
  numbers and a registration, start or end date is within 3 days. The kept
  record is one with a team decision, else curated, Unstop, Devfolio, MLH,
  Devpost in that order; it takes the most specific tier of the group.
- **What needs attention** works per section with its own "seen" list
  (`certamus-radar.seen.hack.<email>`), same rules; in-person-abroad items are left
  out of both lists unless the abroad toggle is on.
- **Clashes use one committed set across both sections**: anything
  Entering or Registered in either section clashes with the other, and the
  warning names the section ("Clashes with HaritVitt (case comp)"). The
  calendar shows this section's Watching items plus both sections'
  Entering and Registered items; the other section's items carry a small
  "Case" or "Hack" marker.
- **Competition page:** the hackathon eligibility table (the checks of
  `fetch/hack-classify.js`, in its order), kind, place, team, fee, prizes
  and source. Curated `hk-` rows show the curated facts (entry route, who
  applies, undergraduates, last edition, official page check) and the
  watcher flag. "Set dates" is case comps only (the `intl_dates` table
  accepts `intl-` ids).
- Adding a link by hand is case comps only.

## What gets fetched

### Sources

Unstop covers about 75–80% of what the team would enter; the other four
sources fill the gaps it can't see. Every non-Unstop record carries a
`source` and its own tier and verdict (classify is not run on it), and a
failure in any of them is a warning in the run status, never a failed run:
that source's previous records pass through unchanged.

| Source | Where | Tier | What it adds |
|---|---|---|---|
| **Unstop full scan** | `fetch/unstop.js`, public JSON API | by host (below) | every open competition, classified |
| **Curated international** | `data/international.json`, hand-edited | `international` | 25 flagship international competitions (see "International competitions") |
| **Opportunity Desk** | `fetch/oppdesk.js`, WordPress API | `international` | posts whose title reads as a case competition, deadline parsed from the body |
| **InsideIIM** | `fetch/insideiim.js`, one fetch of `insideiim.com/competitions` | `corporate` | corporate competitions run through InsideIIM (Cummins, Reckitt, Axis...) |
| **Fest watchlist** | `data/fests.json`, hand-edited | the row's own (`iit` / `iim`) | fests that register on their own site, not Unstop: IIT Bombay E-Summit, IIT Delhi BECon, IIM Calcutta Intaglio, IIT Kharagpur Kshitij |

**InsideIIM.** robots.txt allows `/` and disallows `/api/`, so the fetcher
reads only the competitions page, once per run, and parses the Next.js
flight payload embedded in the HTML. It keeps `ACTIVE` listings whose
deadline has not passed (InsideIIM leaves closed rounds `ACTIVE` for
months). Ids are `iim-<InsideIIM id>`; links go to the listing's page on
insidekampus.com, InsideIIM's own competitions site (or the listing's
insideiim.com page for external ones). A per-campus round ("Reckitt DARE
2026 - IIM Bangalore") gets host "Reckitt – IIM Bangalore". Verdict: *fits*
if the campus list names IIM Sirmaur or the eligibility says open to all;
*check* ("Campus-restricted: check whether IIM Sirmaur is an eligible
campus") if it names other campuses only; otherwise *check* ("Eligibility on
InsideIIM"). Descriptions and eligibility text are read for two flags and
never stored.

**Fest watchlist.** `data/fests.json` has the same row shape as
`data/international.json` plus a `tier`; ids start `fest-`. The rows become
`source: 'curated'` records, so they sit on the main Board list under IIT or
IIM with the same "expected" dates and "Official page changed" flag as the
curated international items, and the weekly watcher hashes their pages
too. Months are filled only when verified from the page (none were on
2026-09-30: three of the four pages are script-rendered and show little
more than their title). A missing `fests.json` just means no fest rows.

### Unstop

**Full scan.** Each run pages through *every* open Unstop competition
(`/api/public/opportunity/search-result?opportunity=competitions&oppstatus=open&per_page=30&page=N`),
following `data.last_page` (about 23 pages, ~25 requests with a 1 s pause
each and one retry per page; `MAX_PAGES` is 60). There is no keyword
filter: a keyword search missed real case competitions whose titles lack
our words, such as IIM Lucknow's "Thrive - The Sustainability Solutions
Challenge" and XLRI's "Strike or Yield".

**Format classes.** `fetch/unstop.js` gives every listing a `format_kind`
from its Unstop type/subtype, its title and (for the B-school lean) its
host name, never its body text:

- `case`: subtype `case_competition`, or a title with case / consult /
  strategy / teardown / war room / LIME / crucible.
- `business`: a business event: B-plan, pitch, ideathon, bid / auction,
  marketing, finance / investment / stock / trading, HR, operations, policy,
  product, entrepreneurship / startup / venture, sustainability solutions and
  the like; plus any other competition at a management, business or
  commerce school (flagship events included). Shown with a "Business event"
  chip.
- `other`: quizzes, hackathons and coding challenges (by type), article /
  essay writing, robotics, CTFs, game jams, CAD / RC / drones, event
  passes, olympiads, courses and bootcamps, research posters, and cultural
  or sports events.

Written-only formats (quiz, article, essay) beat even a `case_competition`
subtype; tech-fest formats beat business words. `is_case` is kept for older
readers and means "belongs on the main list": `format_kind !== 'other'`.
The Board's "Quizzes and other formats" toggle shows the rest.

**Tiers** (checked in this order, by host name):

| Tier | Label | Source |
|---|---|---|
| `iit` | IIT | Indian Institute of Technology / `IIT` (never `IIIT`) |
| `iim` | IIM | Indian Institute of Management / `IIM` (IIM Mumbai, ex-NITIE, stays here) |
| `national` | NIT / IIIT / national institutes | `data/national.json`: NITs, IIITs, IISc, IISERs, BITS Pilani, ISI, DTU, NSUT, IIEST, Jadavpur, NITIE |
| `bschool` | B-school / top college | `data/bschools.json`: ISB, XLRI, FMS, SPJIMR, MDI, IIFT, JBIMS, NMIMS, Symbiosis, IMT, XIM, TAPMI, Great Lakes, IRMA, MICA, TISS, IBS, SIMSR, Welingkar, SRCC, St. Stephen's, LSR, Hindu, Hansraj, Kirori Mal, Christ, St. Xavier's Mumbai/Kolkata |
| `corporate` | Corporate | `data/corporates.json` |
| `other` | Other | everything else |

The Board and the "What needs attention" panel cover every
tier except Other.

## Hackathons data

The Hackathons section (see "Sections" above) is the `hack` section of the
database's `listings`, `archive` and `source_status` tables (see "Data"
below), written only by `fetch/hack-run.js` in the same `fetch.yml` job as
the case comps, with the same merge, 60-day archive, decision and privacy
rules (shared code in `fetch/pipeline.js`). Each section records its own
status; the job goes red only when both sections fail. Every source is
optional: a failing one is a warning in the hack status (which also
carries a per-source `sources` count) and its previous records pass
through. The run fails, writing only its status, when all four fetched
sources fail or the live hackathon rows cannot be read.

| Source | id | Tier | Notes |
|---|---|---|---|
| Unstop `opportunity=hackathons` full scan | numeric | by host | ~230 open on 8 pages; eligibility from course lists, stream filters and passout years |
| Devfolio search API (`application_open`, POST, pages of 50) | `df-<uuid>` | by venue, `global` outside India | url `https://<slug>.devfolio.co/`; team_min/team_size |
| MLH current season page (`mlh.com/seasons/<year>/events`, Inertia JSON) | `mlh-<slug>` | `global` | registration taken to close at the start date |
| Devpost `/api/hackathons?status[]=open` (JSON; robots allows) | `dp-<id>` | `global` | deadline = submission end |
| `data/hack-curated.json` (fest row shape, verified by hand) | `hk-<name>` | row's `corporate` / `national` | watched weekly by `fetch/watch.js`; Unstop-hosted rows have no `watch_url` (Unstop serves the same script shell for every listing) |

**Kinds** (`hack_kind`, `fetch/hack-classify.js`): `build` (hackathons,
buildathons, make-a-thons, game jams) and `ideathon` (ideathons, pitch /
B-plan / startup / innovation challenges). Everything else is `other`:
coding contests, CTFs, Kaggle-style datathons, quizzes, robotics, esports,
posters, passes, and Unstop titles that say nothing whose body doesn't say
hackathon or ideathon. `other` records stay in the file, hidden from the main
list, like case comps' `format_kind: 'other'`: a regex change never "closes"
a record someone has a decision on, and a mis-sorted item is one toggle away.

**Tiers:** iit, iim, national, bschool as for case comps, `corporate` from
`data/hack-corporates.json`, `global` (MLH, Devpost, non-Indian Devfolio
hosts) and `other`. `main: true` means tier is not `other` and kind is not
`other`: the Board's default list.

**Eligibility** against `data/hack-team.json` (Krishna: UG, management +
science, 2029; Akshit: UG, engineering, 2028; `can_grow`):

- *out*: not open to students; school students only; postgraduate only;
  the listed years or courses exclude every member.
- *check*: only some members eligible ("only Akshit is eligible by
  course"); same-college teams; `team_min` above 2 ("needs 3 members,
  recruit"); entry fee; eligibility not stated; in-person abroad; women
  only; invite only.
- *fits*: otherwise.

Only the verdict and reasons are stored: body text, FAQ answers and the raw
eligibility blob are read in memory and dropped.

## Registered ✓

Independent of Watching / Entering / Skipped: a competition can be marked
**Registered** with any status, or none. Toggle it from a card (admin)
or the Competition page panel. The "committed" set used for clash checking,
and the calendar is *Entering OR Registered* — so a competition
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

A weekly Action (`fetch/watch.js`, Mondays 05:00 IST) fetches each curated
competition's official watch page (international and fest watchlist alike), strips it down to text and hashes it. A
changed hash shows **"Official page changed on \<date>, new edition?"** on
the card — a
prompt to go check the page by hand, not an automatic date update.

To confirm real dates once you've checked a page: open the competition on
`c.html`, use **Set dates** (admin) to enter the registration close and
competition end. That writes the `intl_dates` table; the
Competition page shows the dates at once, and the calendar, board and clash
checks pick them up after the next fetch (the page says so when you save).

## Archive

Closed competitions are archived (the `archive` table, per
section) when a fetch prunes them out of the live rows (60 days after they
close, or 60 days after a committed team ends up entering/registering).
Curated international entries never get pruned as *hosts*: only a specific
edition's confirmed dates close, so it archives by `id@regn_close`, one
entry per edition. The Hosts & archive page lists it, newest first,
searchable; while it holds under 30 days of history it says so plainly
rather than looking empty by mistake.

The board has a "Quizzes and other formats" toggle: records carry
`format_kind` and `is_case`, and `other` formats (quizzes, article calls,
coding challenges, robotics...) are hidden by default.

## Data (Railway Postgres, through the API)

All generated data lives in a Railway Postgres database (`db/schema.sql`),
reached only through the Radar API (`api/`, see "Railway" below); the repo holds
only code and the hand-edited config files in `data/` (`team.json`,
`hack-team.json`, `national.json`, `bschools.json`, `corporates.json`,
`hack-corporates.json`, `international.json`, `fests.json`,
`hack-curated.json`). Nothing commits data to the repo any more, and the
email digest is gone (retired 2026-09-30; the Board's "What needs
attention" panel replaced it).

- **Daily 06:00 and 18:00 IST** `fetch` workflow: `fetch/run.js` (section
  `case`) and `fetch/hack-run.js` (section `hack`).
- **Monday 05:00 IST** `watch` workflow: `fetch/watch.js`.

| Table | Written by |
|---|---|
| `listings` (one row per competition, keyed `(section, id)`; the record is in `data`) | the fetch jobs, through `sync_section` |
| `archive` (keyed `(section, archive_key)`) | the fetch jobs, through `sync_section` |
| `source_status` (one row per section: last run, last ok, error, warnings, sources) | the fetch jobs (`sync_section` on success, `set_status` on failure) |
| `watch` (official-page hashes) | `fetch/watch.js` (upsert) |
| `decisions`, `manual`, `intl_dates` | the board (admin) |

How a fetch run writes (`fetch/db.js`, `fetch/pipeline.js`):

1. Read the section's live rows (`listings`). If that read fails the run
   stops: it is never treated as empty, and only the error status is
   written.
2. Read `decisions`, `manual` and `intl_dates`. A failed read is a warning:
   decisions are then empty **and nothing is pruned** (an entered record
   would otherwise look expired), hand-added links are skipped, curated
   records keep yesterday's dates.
3. Fetch every source. A failing source passes its previous records
   through unchanged (case: Opportunity Desk, InsideIIM, the curated lists;
   hackathons: every source, and the run fails only if all four fetched
   sources fail).
4. Merge, then **one** `sync_section(section, rows, archive, status)` call,
   one transaction: insert the pruned records' archive entries, upsert the
   rows, delete that section's rows not in `rows`, record the status. It
   refuses an empty `rows` while the section has listings.
5. On any failure: read the previous status and call `set_status` with the
   error, carrying the previous `last_ok` and `sources` (or `last_ok: null`
   if the previous status is unreadable), so the banner says how old the
   data is.

The watcher reads the previous hashes from `watch` (a failed read writes
nothing) and upserts the new ones.

**Service token.** The jobs call the API with two repository secrets
(Settings → Secrets and variables → Actions): `RADAR_API_URL` (the API
origin) and `RADAR_SERVICE_TOKEN` (the same value as the API's Railway
variable), sent as `Authorization: Bearer`. The API runs those calls as the
`radar_service` database role, which can read and write the listings,
archive, status and watch tables and read decisions / intl_dates / manual,
and nothing about members, teams or rounds. Without the secrets every job
fails without writing.

**Seeding (once, at cutover).** `db/seed.mjs` reads the last committed
data files (`competitions.json`, `hackathons.json`, the two status files,
the two archives and `watch.json`) from a local `db/seed/` folder, plus,
if present, `decisions.json`, `intl_dates.json` and `manual.json` exported
from the old database. That folder is git-ignored and must never be
committed: listing data is login-only now. `main` keeps fetching until
cutover, so export the files right before seeding, then (after
`db/schema.sql` is applied, the API is up and `db/check-access.mjs`
passes, before the first fetch runs against it) seed:

```bash
git fetch origin main
mkdir -p db/seed
for f in competitions hackathons status hack-status archive hack-archive watch; do
  git show origin/main:data/$f.json > db/seed/$f.json
done
# the admin's rows (HANDOFF.md has the export commands)
export RADAR_API_URL=https://... RADAR_SERVICE_TOKEN=... DATABASE_URL=<owner URL>
node db/seed.mjs --dry-run
node db/seed.mjs
```

It pushes each section through `sync_section` (so `first_seen`,
`closed_on` and the archive carry over), upserts the watch rows, and adds
the admin's rows whose ids are not there yet. It refuses a section that
already has listings unless given `--force`.

Listing body text is used to classify each competition but is never stored
or published: it often carries organisers' personal phone numbers and
emails.

## Sign-in and roles

The whole site is login-only. Every page loads its module and then
`lib/auth.js`, which runs before anything is read:

- **Not signed in:** a "Sign in with Google" screen. The button goes to
  the API (`API_URL/auth/google?return=<this page>`), which runs Google's
  sign-in (authorization code + PKCE), checks the Google-verified email is
  an active row in `members`, and comes back to the same page with a
  one-time `?radar_code=` (valid 60 seconds, and only together with a
  random value this tab put in its sessionStorage before leaving, whose
  hash went to the API: a code planted from another browser is useless). The page swaps it for a
  30-day session token (kept in this browser's localStorage) and removes
  only `radar_code` from the address, so a deep link such as
  `c.html?id=…&s=hack` survives sign-in.
- **Sign-in failed** (cancelled at Google, Google error, or the account is
  not on the team list): the API comes back with `?radar_error=<reason>`;
  the page removes it and shows the reason on the login screen ("Not on
  the team list. Ask Krishna to add the Google account you used…").
- **The admin:** the page loads; the nav shows their name and **Sign out**
  (which also ends the session on the server).
- **A teammate (role `member`):** whatever page they open, they are sent
  to `team.html` (`location.replace`, nothing from the address carried
  over) before anything is read. There the header shows only "Certamus
  Radar", their name and **Sign out**.
- When the session ends (30 days, signed out in another tab, removed from
  `members`), the next request gets 401 and the page goes back to the
  login screen.
- **github.io:** `krishnachagti-sudo.github.io/certamus-radar/` only shows
  "Radar now lives at https://conyso.com/certamus/radar/" with a link (the
  API accepts return addresses on the allow-listed origins only).

Roles come from `members.role`:

| Role | Can |
|---|---|
| `admin` (Krishna) | everything: statuses, Registered, notes, "Set dates", add an Unstop link (direct writes to `decisions`, `intl_dates`, `manual`, allowed by RLS for `is_admin()` only) |
| `member` (teammates) | one screen (`team.html`): the competitions they are in, to join and joined; tick or undo their own "I've joined". Nothing else: no radar pages, rounds, notes or teammates' statuses |

A decision row is deleted when its status, Registered and note are all
empty, and upserted otherwise. A refused or failed write (RLS, network)
shows "Not saved: …" in the banner and the change stays on screen. The
admin's pages read `listings`, `archive` and `source_status` by section, plus
`watch`, `decisions`, `intl_dates` and `manual`; the curated config files
(`international.json`, `fests.json`, `hack-curated.json`) are still read
from `./data/`.

The database enforces the teammate's view, not just the pages
(Resolution 21 of the spec). A teammate can read only their own `members`
row (so the sign-in can show their name and role), the `teams` rows of
teams they are in, and their own `team_members` rows (never a teammate's
join status). Everything else (`listings`, `archive`, `source_status`,
`watch`, `decisions`, `intl_dates`, `manual`, `rounds`, other people's
`members` rows) is readable by the admin only. The member screen's one
read is the `my_joins()` RPC, which returns per team only `listing_id`,
`section`, title, `regn_close`, `invite_url` and `joined_at`, so no whole
listing record reaches a teammate. Their only write is `mark_joined` on
their own row.

Identity comes from the session, never from the browser: the API looks
the bearer token up (by its sha256) in `private.sessions`, which holds only
sessions it issued after Google verified the address, and runs the request
as the `radar_member` role with `app.email` set to that session's email.
`is_member()`, `is_admin()`, `in_team()` and `is_self()` read it from there.
So `members.email` must be the Google account's address, lowercased.

Members are managed with SQL as the database owner (Railway → Postgres →
Data, or `psql`; no client writes):

```sql
insert into public.members (email, name, role) values ('name@gmail.com', 'Name', 'member');
update public.members set active = false where email = 'name@gmail.com';  -- loses access on the next request
```

## Teams, invite links and rounds

The workflow: Krishna finds a competition, registers on Unstop (or
Devfolio...) and copies its "invite teammates" link; on the competition
page he records the team; each teammate opens the link, joins, and ticks
"I've joined"; Krishna sees who he is still waiting on. Rounds track the
team's own deadlines (prelims deck, video, finals) after registration;
they are Krishna's alone (teammates never see them).

- **Competition page, Team section** (between Dates and Team note).
  - No team yet: the admin sees **Create team**: a checkbox per active
    member (ticked by default: for a case comp the case roster, i.e. every
    active member except Akshit; for a hackathon Krishna and Akshit, each
    if they are active members), an https invite-link field and Save.
    Creating the team also ticks **Registered** (the `create_team` RPC
    does both in one transaction).
  - Team exists: each member with **✓ joined (date)** or **pending**; the
    invite link (read-only field, **Copy**, Open ↗); the admin's own row
    has **I've joined** / **Undo**. **Edit team** (members and link) and
    **Delete team** (asks first; deletes members, joins and rounds;
    Registered stays).
  - **Rounds:** name, due date, owner (a team member or "Team") and a
    done box. Undone rounds past their due date are red. The admin adds,
    edits, deletes and ticks rounds done (`set_round_done` refuses anyone
    else).
- **Team page** (`team.html`, "Team" in the admin's nav).
  - **Admin:** **Waiting on teammates** (everyone else's pending joins,
    grouped by person) and **All teams** (section, "2/3 joined", the next
    round due from today and an overdue count), plus their own joins and
    **My rounds** when there are any. A team whose listing was pruned
    shows under its archived title.
  - **Teammate:** the only screen they ever see. **To join (N)**: each
    competition they are in but have not joined, soonest registration
    deadline first: the title (plain text, no link), a Case comp /
    Hackathon label, "Registration closes …" when known, the invite link
    with **Copy** and **Open ↗**, and a big **I've joined** button.
    **Joined (N)**: newest first, with the date and a small **Undo**.
    Empty states: "Nothing to join right now." and "You haven't joined
    anything yet." Built for a phone (big tap targets).
- **Board** (admin): above "New since your last visit", the admin's own
  pending joins (**Join these teams (N)**) and **Waiting on teammates
  (N)** by person. Nothing shows when neither applies.
- **Calendar** (admin): each dated round is a 📝 event (both
  sections; the other section's carry the Case/Hack marker). Undone
  rounds count as committed dates in the clash days, but never against
  their own competition or sibling rounds.

Who sees what is decided by RLS, not the page: `teams` is readable by the
admin and by that team's members only, so an invite link never reaches
anyone outside the team; `team_members` by the admin and, for a teammate,
their own rows only; `rounds` by the admin only. A teammate's screen reads
only `my_joins()`. Every change goes through an RPC that re-checks the
caller (`create_team`, `update_team`, `delete_team`, `upsert_round`,
`delete_round` and `set_round_done` are admin-only; `mark_joined` is the
caller's own row in a team they are in; see `db/schema.sql`); a refusal shows the Postgres
message in the banner. Invite links must be `https://` (checked in the
page and again in the database) and are only ever rendered through
`safeHref`. Pure rules live in `lib/teams.js`, HTML in `lib/teamview.js`.

## Setup (once)

1. What needs attention: the top of the Board has a panel with two lists:
   **New since your last visit** (top-tier case competitions, not Out, not
   Skipped, not Registered, that this person has not seen on this device;
   on a first visit, anything first seen in the last 7 days) and **Closing
   within 10 days, not registered yet**. "Mark all seen" is remembered in
   this browser's localStorage per signed-in user
   (`certamus-radar.seen.<email>`; the Hackathons Board keeps its own in
   `certamus-radar.seen.hack.<email>`). For the admin each row has a
   Registered checkbox. Nothing to set up.
2. Pages: Settings → Pages → Build and deployment → **Deploy from a branch**,
   branch `main`, folder `/ (root)`, proxied by nginx at
   `https://conyso.com/certamus/radar/`.
3. The API and database: see "Railway" below and HANDOFF.md.

## Railway

The API (`api/`) and its Postgres run on Railway. The service builds from
this repo's root (`package.json`: `npm start` runs `node api/server.js`;
`railway.json` sets the start command and the `/healthz` health check).
The static pages need none of it: they are plain files and can be hosted
anywhere.

| Variable (API service) | What |
|---|---|
| `DATABASE_URL` | Postgres URL logged in as **`radar_api`** (not the owner), e.g. `postgresql://radar_api:<password>@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}` |
| `GOOGLE_CLIENT_ID` | the Google OAuth web client's ID |
| `GOOGLE_CLIENT_SECRET` | its secret (also keys the sealed sign-in cookie) |
| `RADAR_SERVICE_TOKEN` | at least 32 random characters; the same value is the GitHub secret of that name |
| `ALLOWED_ORIGINS` | comma-separated site origins, e.g. `https://conyso.com` (CORS and sign-in return addresses); `http:` ones are refused next to an https API unless `RADAR_DEV_ALLOW_HTTP=1` (local testing only) |
| `RETURN_PATH_PREFIXES` | optional, default `/certamus/radar/`: the paths sign-in may return to (comma-separated, each starting and ending with `/`) |
| `API_ORIGIN` | the API's own public origin, e.g. `https://certamus-radar-api.up.railway.app` (Google redirects to `API_ORIGIN/auth/callback`) |
| `PORT` | set by Railway |

Endpoints: `GET /healthz`; `GET /auth/google?return=`, `GET /auth/callback`,
`POST /auth/exchange`, `GET /auth/me`, `POST /auth/signout`;
`GET|POST|DELETE /db/<table>` (PostgREST-style `select=`, `col=eq.v`,
`order=`, `offset=`, `limit=` up to 1000; POST upserts on the table's key,
`?ignore_duplicates=true` to keep existing rows); `POST /rpc/<fn>` with
named arguments. Only the tables, columns and functions in `api/rest.js`
exist; all SQL is parameterised; errors are `{ message, code }` with the
Postgres code (42501 → 403, bad input → 400).

Database roles (`db/schema.sql`, applied by the owner with
`DATABASE_URL=<owner URL> RADAR_API_PASSWORD=<new password> node db/apply.mjs`):
`radar_api` (the API's login; owns nothing, holds no table privileges,
can call the four session functions and switch to the next two),
`radar_member` (a signed-in person; RLS decides every row) and
`radar_service` (the jobs). The database must hold Radar only.

## Tuning

`data/team.json` (size, graduating years), `data/national.json`,
`data/bschools.json` and `data/corporates.json` (case-insensitive regexes on
the host name that decide the tier), `data/international.json` (the curated international list) and
`data/fests.json` (the fest watchlist; each row names its tier), both
hand-edited. Edit, commit, and the next fetch applies them. `fetch/unstop.js`'s
`formatKind` rules decide case / business / other.

## Develop

```bash
npm install         # pg, and PGlite for the tests
npm test            # unit tests, SQL tests (PGlite) and API tests; no network
RADAR_API_URL=... RADAR_SERVICE_TOKEN=... npm run fetch       # live case-comp fetch through the API
RADAR_API_URL=... RADAR_SERVICE_TOKEN=... node fetch/hack-run.js
RADAR_API_URL=... RADAR_SERVICE_TOKEN=... node fetch/watch.js # checks every curated official page
```

Tests never touch the network: `fetch/db.js` and `lib/api.js` take an
injected `fetch`, the job tests use an in-memory stand-in, and
`db/schema.sql` and the API run against PGlite (Postgres in WASM; see
`test/helpers/pg.js` for its one gap: SET ROLE permission is checked
against the session user, a superuser there, so role membership is checked
with `pg_has_role()` instead).

Unstop's API is undocumented. If the board shows "Data stale", open the
failed `fetch` run: a shape change means `fetch/unstop.js` needs updating.
