# Handoff: Certamus Radar on Railway

For Rohit. Status as of 2026-10-05. Everything is built and tested on the `railway` branch (`npm test`, no network needed). What is left is the cutover: Railway (API, Postgres, two cron services), Google, hosting, members, seed, merge. Nothing on `main` has changed, so the old public site keeps working until the merge.

**You own all of it.** Every step below is yours, in your own Railway account and as an Owner of the Google Cloud project. Nothing depends on GitHub repository secrets or GitHub Actions any more (the scheduled jobs moved to Railway cron services), so you never need the repo owner to set anything. The **only** thing Krishna (the owner) does is send you the five members' Gmail addresses for step 8.

The README is the full reference ("Railway", "Data", "Sign-in and roles", "Teams, invite links and rounds"). The binding design is in the owner's other repo: `docs/superpowers/specs/2026-10-04-certamus-radar-platform-design.md`, Resolutions 21 (teammates' single screen) and 22 (Railway instead of Supabase).

## What it is

| Piece | Where |
|---|---|
| Static pages (`*.html`, `lib/`, `pages/`, `config.js`) | any static host; they call the API cross-origin |
| API (`api/`, Node 20, `pg`, no framework) | a Railway service built from this repo's root (`npm start`, `railway.json`) |
| Database (`db/schema.sql`) | Railway Postgres; RLS decides every row |
| Jobs (`fetch/`, `fetch/job.js`, `railway/fetch.json`, `railway/watch.json`) | two Railway cron services from the same repo, calling the API with a service token |

Roles: the owner (`krishnachagti@gmail.com`, `admin`) sees everything. Teammates (`member`) get only `team.html` (To join / Joined). The database enforces it.

## Steps, in order

Steps 1 to 6 break nothing; the old site keeps running.

1. **Railway project** (your Railway account). New project → add **PostgreSQL**. Then add a service from the GitHub repo `krishnachagti-sudo/certamus-radar`, branch `railway` for now (switch to `main` after the merge), root directory = repo root. Generate a public domain for it (Settings → Networking); call it `API_ORIGIN` below, e.g. `https://certamus-radar-api.up.railway.app`. **The first deploy is expected to fail** (crash at start, health check red): the API refuses to start until all its variables exist, and they are only set in step 4. That is fine; carry on.

2. **Schema.** From your machine, with the Postgres service's **public** owner URL (`DATABASE_PUBLIC_URL` on the Postgres service) and a new random password for the API's login role:
   ```bash
   npm install
   DATABASE_URL='<owner public URL>' RADAR_API_PASSWORD="$(openssl rand -hex 32)" node db/apply.mjs
   ```
   Keep that password for step 4 only (it goes into Railway, nowhere else). The script sends Postgres only a SCRAM verifier of it, with statement logging off for that transaction, so it never appears in the database logs. It is idempotent; later runs without `RADAR_API_PASSWORD` keep the password. It creates the roles `radar_api` (login), `radar_member`, `radar_service`, all tables with RLS, and the owner as admin. This database must hold Radar only.

3. **Google OAuth client** (needs `API_ORIGIN` from step 1). Google Cloud project "Certamus Radar" (`lofty-shine-510620-k1`). Krishna is adding you to it as **Owner**:
   - Accept the IAM invite from the email Google sends you (IAM & Admin → IAM should then list you as Owner), and switch the console to that project.
   - Google Auth Platform (APIs & Services → OAuth consent screen): the consent screen was left at its final step. Tick the "Google API Services: User Data Policy" agreement and press **Create**. If it asks again, the app name is "Certamus Radar", audience **External**, support and developer contact your own address.
   - Then Clients → Create client → **Web application**:
     - Authorised redirect URI: `API_ORIGIN/auth/callback` (exactly).
     - Authorised JavaScript origins: none needed (the browser never talks to Google directly from a page script).
   - Under Audience, either publish the app (scopes are only `openid email`; no verification needed) or add the owner and the five members (step 8) as test users.
   - Note the Client ID and secret for step 4.

4. **API variables** (the API service → Variables), all at once:
   - `DATABASE_URL` = `postgresql://radar_api:<password from step 2>@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}` (log in as `radar_api`, never the owner; private network, no SSL needed)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from step 3
   - `RADAR_SERVICE_TOKEN` = `openssl rand -base64 48` (at least 32 characters)
   - `ALLOWED_ORIGINS` = the site's origin(s), comma-separated, e.g. `https://conyso.com`. `http:` origins are refused next to an https API; for local testing only, add `http://localhost:8080` together with `RADAR_DEV_ALLOW_HTTP=1`, and remove both afterwards.
   - `RETURN_PATH_PREFIXES` (optional) = the path(s) the radar's pages live under, comma-separated, each starting and ending with `/`. Default `/certamus/radar/`. Sign-in only ever returns to pages under these paths, so a sign-in code never reaches another page on the same origin. Set it if the pages are hosted elsewhere (e.g. `/` on a dedicated Cloudways app).
   - `API_ORIGIN` = the public origin from step 1, no trailing slash

   Redeploy. Now `GET API_ORIGIN/healthz` must answer `{"ok":true}`. A missing or malformed variable stops the service at start with the variable's name in the log (never its value).

5. **Site config.** In `config.js`, set `API_URL` to `API_ORIGIN`, and replace `https://certamus-radar-api.up.railway.app` in the CSP `connect-src` of all six `*.html` files with the same origin (`npm test` fails if they differ). Commit on `railway`.

6. **Cron services** (the scheduled jobs; they replace the old GitHub Actions workflows, which are deleted). In the same Railway project, twice: New → GitHub Repo → `krishnachagti-sudo/certamus-radar`, same branch as the API (`railway` for now), root directory = repo root. For each:

   | | `fetch` service | `watch` service |
   |---|---|---|
   | Settings → Config-as-code → **Railway Config File** | `/railway/fetch.json` | `/railway/watch.json` |
   | what the file sets (check it shows in Settings) | start `npm run job:fetch`, cron `30 0,12 * * *`, restart Never | start `npm run job:watch`, cron `30 23 * * 0`, restart Never |
   | IST | 06:00 and 18:00 daily | Monday 05:00 |

   Railway cron schedules are in **UTC**; the files already carry the UTC times. If the config file path is not picked up, set the same three things by hand in the service's Settings: Custom Start Command, **Cron Schedule**, Restart Policy = Never; and remove the health check path (a cron job serves nothing). Do **not** leave a cron service on the root `railway.json`: that one starts the API.

   Variables on **each** cron service (replace `api` with your API service's name in Railway):
   - `RADAR_SERVICE_TOKEN` = `${{api.RADAR_SERVICE_TOKEN}}` (a reference, so a rotation on the API carries over)
   - `RADAR_API_URL` = `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` (the public origin, simplest), or over the private network `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`, which needs `PORT` set explicitly on the API service (e.g. `8080`) so it can be referenced.

   The `fetch` run exits 1 (red on Railway) only when **both** sections fail; one section failing is shown on the board through its status. Until step 10 the database is empty, so the first scheduled runs before the seed would write into it: either do steps 6 and 10 on the same day before the next 00:30 / 12:30 UTC, or create the cron services only right after the seed.

   The repo's old GitHub secrets (`SUPABASE_SERVICE_KEY` and any others) are no longer read by anything; ignore them.

7. **Static hosting.** Pick one, keep it short:
   - **conyso.com nginx proxy (as planned before):** the pages stay on GitHub Pages from `main`, and nginx on the conyso.com server serves them under `/certamus/radar/`:
     ```nginx
     location = /certamus/radar { return 301 /certamus/radar/; }
     location /certamus/radar/ {
         proxy_pass https://krishnachagti-sudo.github.io/certamus-radar/;
         proxy_set_header Host krishnachagti-sudo.github.io;
         proxy_ssl_server_name on;
         proxy_ssl_name krishnachagti-sudo.github.io;
         proxy_hide_header Cache-Control;
         include /path/to/nginx-security-headers.conf;   # the server's existing include
         add_header Cache-Control "no-store" always;
     }
     ```
     then `nginx -t && systemctl reload nginx`. `ALLOWED_ORIGINS` = `https://conyso.com`; `RETURN_PATH_PREFIXES` stays at its default.
   - **Cloudways static app:** deploy the repo's static files (everything except `api/`, `db/`, `fetch/`, `test/`, `node_modules/`) and set `ALLOWED_ORIGINS` to that app's origin and `RETURN_PATH_PREFIXES` to the path the pages are served under (`/` if at the root). Send `Cache-Control: no-store` for `*.html`. If it is not on conyso.com, also change `RADAR_HOME` in `lib/auth.js` (the github.io notice links there).

8. **Members.** Krishna sends you the five Gmail addresses (the three case-comp teammates, Akshit, and anyone else he names); this is the only thing he does. You add them with the database owner login (Railway → Postgres → Data → Query, or `psql` with the owner URL), lowercase Gmail addresses:
   ```sql
   insert into public.members (email, name, role) values ('name@gmail.com', 'Name', 'member');
   ```
   Removing someone: `update public.members set active = false where email = '…';` (their session stops working on the next request).

9. **Access check.** `RADAR_API_URL=API_ORIGIN node db/check-access.mjs`: every table, function and `/auth/me` must be refused (401/403) with no token and with a made-up one.

10. **Seed, then merge.** Back to back, so no fetch runs on an empty database:
    1. Export the history (README "Data", "Seeding"): the seven `data/*.json` files from `origin/main` into `db/seed/` (git-ignored; never commit it).
    2. Export the owner's own rows from the old database. Under its old schema those three tables are readable with the old publishable key, which is still in `config.js` on `main`:
       ```bash
       OLD=$(git show origin/main:config.js | sed -n "s/.*SUPABASE_URL = '\(.*\)'.*/\1/p")
       KEY=$(git show origin/main:config.js | sed -n "s/.*SUPABASE_ANON_KEY = '\(.*\)'.*/\1/p")
       for t in decisions intl_dates manual; do curl -s "$OLD/rest/v1/$t?select=*" -H "apikey: $KEY" > db/seed/$t.json; done
       ```
       Check each file is a JSON array before going on.
    3. `RADAR_API_URL=… RADAR_SERVICE_TOKEN=… DATABASE_URL='<owner public URL>' node db/seed.mjs --dry-run`, then without `--dry-run`.
    4. Merge `railway` → `main` and push; point the API and both cron services at `main` (each service → Settings → Source → branch). Run `fetch` and `watch` once by hand (Railway's "Run now" on the cron service if your dashboard has it, otherwise locally: `RADAR_API_URL=API_ORIGIN RADAR_SERVICE_TOKEN=… npm run job:fetch`, then `job:watch`); both must exit 0 and the board must show listings. Then check the first scheduled runs in each cron service's Deployments.

11. **Verify.**
    - The site, signed out: the login screen. The owner signs in: every page loads; set a status, add and delete a test team, add and tick a round.
    - A teammate's account (or ask one): any page lands on "Your teams" with only To join / Joined and no nav; I've joined and Undo work; `c.html?id=…` sends them back to the team page.
    - A Google account not on the list: back on the login screen with "Not on the team list…".
    - The github.io address shows the "moved" notice.

## Things to know

- **Secrets:** the repo is public. Never commit the service token, the Google secret, any database URL or `db/seed/`. Commits before `ce7d372` on `main` contain organisers' contact details in old data files; a history rewrite was offered to the owner and not done.
- **Sessions:** 30 days, a bearer token in the browser's localStorage, stored hashed (sha256) in `private.sessions`. Sign-in codes live 60 seconds, work once, and only in the browser tab that started the sign-in (a random value in its sessionStorage, checked by hash).
- **No Supabase any more.** The old Supabase project can be paused or deleted after the seed (step 10.2 is the last thing that reads it).
- **Local demo** outside this repo (the owner's scratchpad, `demo/server.mjs` + `fake-supabase.js`) still fakes the old Supabase client and needs updating for the API before it is used again.
- **Sources that blocked GitHub's runners:** Opportunity Desk and the L'Oréal Brandstorm page answered 403 from GitHub Actions; Railway's egress may or may not fare better. Either way they are recorded as warnings, not failures.
- **Fetch run colour:** `npm run job:fetch` (`fetch/job.js`) exits 1 only if both sections fail.
- **Nothing on GitHub runs.** `.github/workflows/` is gone; the repo only needs to be connected to Railway (Railway's GitHub app) and, for the nginx option, served by GitHub Pages from `main` as today.
- **Open review notes (minor, post-cutover):** send `frame-ancestors` from the static host; no rate limiting on the API (tokens and codes are 256-bit random, so guessing is not a risk; add Railway's or nginx's limits if abuse shows up).
