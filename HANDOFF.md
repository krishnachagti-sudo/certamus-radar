# Handoff: Certamus Radar on Railway

For Rohit. Status as of 2026-10-05. Everything is built and tested on the `railway` branch (`npm test`, no network needed). What is left is the cutover: Railway, Google, secrets, hosting, members, seed, merge. Nothing on `main` has changed, so the old public site keeps working until the merge.

The README is the full reference ("Railway", "Data", "Sign-in and roles", "Teams, invite links and rounds"). The binding design is in the owner's other repo: `docs/superpowers/specs/2026-10-04-certamus-radar-platform-design.md`, Resolutions 21 (teammates' single screen) and 22 (Railway instead of Supabase).

## What it is

| Piece | Where |
|---|---|
| Static pages (`*.html`, `lib/`, `pages/`, `config.js`) | any static host; they call the API cross-origin |
| API (`api/`, Node 20, `pg`, no framework) | a Railway service built from this repo's root (`npm start`, `railway.json`) |
| Database (`db/schema.sql`) | Railway Postgres; RLS decides every row |
| Jobs (`fetch/`, `.github/workflows/fetch.yml`, `watch.yml`) | GitHub Actions, calling the API with a service token |

Roles: the owner (`krishnachagti@gmail.com`, `admin`) sees everything. Teammates (`member`) get only `team.html` (To join / Joined). The database enforces it.

## Steps, in order

Steps 1 to 6 break nothing; the old site keeps running.

1. **Railway project.** New project → add **PostgreSQL**. Then add a service from the GitHub repo `krishnachagti-sudo/certamus-radar`, branch `railway` for now (switch to `main` after the merge), root directory = repo root. Generate a public domain for it (Settings → Networking); call it `API_ORIGIN` below, e.g. `https://certamus-radar-api.up.railway.app`.

2. **Schema.** From your machine, with the Postgres service's **public** owner URL (`DATABASE_PUBLIC_URL` on the Postgres service) and a new random password for the API's login role:
   ```bash
   npm install
   DATABASE_URL='<owner public URL>' RADAR_API_PASSWORD="$(openssl rand -base64 33)" node db/apply.mjs
   ```
   Keep that password for step 3 only (it goes into Railway, nowhere else). The script is idempotent; later runs without `RADAR_API_PASSWORD` keep the password. It creates the roles `radar_api` (login), `radar_member`, `radar_service`, all tables with RLS, and the owner as admin. This database must hold Radar only.

3. **API variables** (the API service → Variables):
   - `DATABASE_URL` = `postgresql://radar_api:<password from step 2>@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}` (log in as `radar_api`, never the owner; private network, no SSL needed; URL-encode the password if it has `/`, `+` or `=`)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (step 4)
   - `RADAR_SERVICE_TOKEN` = `openssl rand -base64 48` (at least 32 characters)
   - `ALLOWED_ORIGINS` = the site's origin(s), comma-separated, e.g. `https://conyso.com` (add `http://localhost:8080` only while testing locally)
   - `API_ORIGIN` = the public origin from step 1, no trailing slash

   Deploy. `GET API_ORIGIN/healthz` must answer `{"ok":true}`. A missing or malformed variable stops the service at start with the variable's name in the log (never its value).

4. **Google OAuth client.** Google Cloud project "Certamus Radar" (`lofty-shine-510620-k1`, the owner's account). The consent screen was left at the final step: the **owner** must tick the "Google API Services: User Data Policy" agreement and press Create. Then Clients → Create client → **Web application**:
   - Authorised redirect URI: `API_ORIGIN/auth/callback` (exactly).
   - Authorised JavaScript origins: none needed (the browser never talks to Google directly from a page script).
   - Under Audience, add the five members as test users or publish the app (scopes are only `openid email`; no verification needed).
   - Put the Client ID and secret into step 3's variables and redeploy.

5. **Site config.** In `config.js`, set `API_URL` to `API_ORIGIN`, and replace `https://certamus-radar-api.up.railway.app` in the CSP `connect-src` of all six `*.html` files with the same origin (`npm test` fails if they differ). Commit on `railway`.

6. **GitHub secrets** (the owner, repo Settings → Secrets and variables → Actions, or `gh secret set`): `RADAR_API_URL` = `API_ORIGIN`, `RADAR_SERVICE_TOKEN` = the same value as in Railway. The old `SUPABASE_SERVICE_KEY` secret can be deleted after cutover.

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
     then `nginx -t && systemctl reload nginx`. `ALLOWED_ORIGINS` = `https://conyso.com`.
   - **Cloudways static app:** deploy the repo's static files (everything except `api/`, `db/`, `fetch/`, `test/`, `node_modules/`) and set `ALLOWED_ORIGINS` to that app's origin. Send `Cache-Control: no-store` for `*.html`. If it is not on conyso.com, also change `RADAR_HOME` in `lib/auth.js` (the github.io notice links there).

8. **Members.** As the owner (Railway → Postgres → Data → Query, or `psql` with the owner URL), lowercase Gmail addresses:
   ```sql
   insert into public.members (email, name, role) values ('name@gmail.com', 'Name', 'member');
   ```
   Add the three case-comp teammates and Akshit. Removing someone: `update public.members set active = false where email = '…';` (their session stops working on the next request).

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
    4. Merge `railway` → `main` and push; point the Railway service at `main`. Run the `fetch` and `watch` workflows by hand; both must go green and the board must show listings.

11. **Verify.**
    - The site, signed out: the login screen. The owner signs in: every page loads; set a status, add and delete a test team, add and tick a round.
    - A teammate's account (or ask one): any page lands on "Your teams" with only To join / Joined and no nav; I've joined and Undo work; `c.html?id=…` sends them back to the team page.
    - A Google account not on the list: back on the login screen with "Not on the team list…".
    - The github.io address shows the "moved" notice.

## Things to know

- **Secrets:** the repo is public. Never commit the service token, the Google secret, any database URL or `db/seed/`. Commits before `ce7d372` on `main` contain organisers' contact details in old data files; a history rewrite was offered to the owner and not done.
- **Sessions:** 30 days, a bearer token in the browser's localStorage, stored hashed (sha256) in `private.sessions`. Sign-in codes live 60 seconds and work once.
- **No Supabase any more.** The old Supabase project can be paused or deleted after the seed (step 10.2 is the last thing that reads it).
- **Local demo** outside this repo (the owner's scratchpad, `demo/server.mjs` + `fake-supabase.js`) still fakes the old Supabase client and needs updating for the API before it is used again.
- **Sources that don't work from GitHub runners:** Opportunity Desk and the L'Oréal Brandstorm page answer 403 there; both are recorded as warnings.
- **Fetch job colour:** `fetch.yml` goes red only if both sections fail.
- **Open review notes (minor, post-cutover):** pin Actions to commit SHAs; send `frame-ancestors` from the static host; no rate limiting on the API (tokens and codes are 256-bit random, so guessing is not a risk; add Railway's or nginx's limits if abuse shows up).
