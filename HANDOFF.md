# Handoff: Certamus Radar platform cutover

Status as of 2026-10-05. Everything is built and tested on the `platform` branch. What is left is the cutover: database migration, auth wiring, secrets, nginx, and merging. Nothing on `main` has changed, so the old public site keeps working until you apply the migration.

The README is the full reference (see "Data (Supabase)", "Sign-in and roles", "Teams, invite links and rounds", "Setup (once)"). The specs and plans live in the owner's other repo: `docs/superpowers/specs/2026-10-04-certamus-radar-platform-design.md` (the Resolutions section is binding) and `docs/superpowers/plans/2026-10-05-certamus-radar-platform.md`.

## What exists

| Piece | Where | State |
|---|---|---|
| Live site (old, public) | `main` → GitHub Pages `krishnachagti-sudo.github.io/certamus-radar/` | running; Actions commit `data/*.json` twice daily |
| New platform | branch `platform` | built; 504 tests pass (`npm test`) |
| Migration | `supabase/v3.sql` | written, idempotent, tested in PGlite (106 checks); **not applied** |
| Access check | `supabase/check-access.mjs` | run after applying v3 |
| One-off history seed | `supabase/seed-from-json.mjs` + `supabase/seed/` (gitignored, local only) | run once, right after v3 |
| Supabase project | `hjgfowgswqafrhlqbuse` (Mumbai, owner's GitHub-login Supabase account) | auth URL config done (see below) |
| Google Cloud project | "Certamus Radar" (`lofty-shine-510620-k1`, owner's Google account) | consent screen half done (see below) |

## Already done in dashboards

- Supabase → Auth → URL configuration: Site URL `https://conyso.com/certamus/radar/`; Redirect URL `https://conyso.com/certamus/radar/**`.
- Supabase → Auth → Providers: Email provider **disabled**; anonymous sign-ins off; Confirm email on; new sign-ups allowed (needed for first Google sign-in).
- Google Cloud → Google Auth Platform → project configuration: app name "Certamus Radar", support and contact email set, audience External. **Stopped at the final step** (the "Google API Services: User Data Policy" agreement checkbox and Create). The owner has to accept that.

## Remaining steps, in order

Do steps 1–4 before step 5. They break nothing.

1. **Google OAuth client.** Finish the consent screen (agree and Create). Then go to Clients → Create client → Web application:
   - Authorised JavaScript origin: `https://conyso.com`
   - Authorised redirect URI: `https://hjgfowgswqafrhlqbuse.supabase.co/auth/v1/callback`
   - Under Audience, either add the five members as test users or publish the app. Basic email/profile scopes need no verification.
   - Paste the Client ID and secret into Supabase → Auth → Providers → Google, then enable it.
2. **GitHub secret.** Run `gh secret set SUPABASE_SERVICE_KEY --repo krishnachagti-sudo/certamus-radar` with the Supabase secret key (Settings → API Keys). Never commit it.
3. **nginx** on the conyso.com server (DigitalOcean; the site is published by `deploy_upload.sh` in the conyso-site repo). Add the block below inside the conyso.com `server {}`, reusing the server's existing `include` line for `nginx-security-headers.conf`, because `add_header` in a location drops the inherited headers. Then run `nginx -t && systemctl reload nginx`.
   ```nginx
   location = /certamus/radar { return 301 /certamus/radar/; }
   location /certamus/radar/ {
       proxy_pass https://krishnachagti-sudo.github.io/certamus-radar/;
       proxy_set_header Host krishnachagti-sudo.github.io;
       proxy_ssl_server_name on;
       proxy_ssl_name krishnachagti-sudo.github.io;
       proxy_hide_header Cache-Control;
       include /path/to/nginx-security-headers.conf;
       add_header Cache-Control "no-store" always;
   }
   ```
4. **Members.** In `v3.sql`, the seed inserts the owner (`krishnachagti@gmail.com`, admin). Add the three case-comp teammates and Akshit as `member`, either by editing the commented `insert` lines before applying, or with SQL afterwards. Use lowercase Gmail addresses; access is tied to the Google identity's email.
5. **Cutover.** Do these back to back. The old site stops working the moment v3 is applied, because anon read is revoked.
   1. Refresh the seed export from `origin/main` (commands in README "Data (Supabase)"). `main` keeps committing data until the merge.
   2. Apply `supabase/v3.sql` in the Supabase SQL editor. This project must be used by Radar only.
   3. `node supabase/check-access.mjs`: every table and RPC must be refused for anon.
   4. Run the seed: `SUPABASE_SERVICE_KEY=… node supabase/seed-from-json.mjs` (add `--dry-run` first). This is also the first live check that an `sb_secret_` key in `apikey` is accepted and that `auth.role()` returns `service_role` inside `sync_section`. Both fail safely (401/42501) if wrong.
   5. Merge `platform` → `main` and push. Run the `fetch` and `watch` workflows by hand and confirm green, with listings populated.
   6. Check `https://conyso.com/certamus/radar/`: login screen when signed out; owner signs in; every page loads; create and delete a test team. The github.io URL should show the "moved" notice.

## Things to know

- **Owner's private edit link:** the `#key` link is retired by v3, which drops `private.editor_key`. Nothing else uses it.
- **Secrets:**
  - The repo is public; never commit secrets.
  - Seed files stay out of git (`.gitignore`).
  - Commits before `ce7d372` on `main` contain organisers' contact details in old data files. A history rewrite was offered to the owner and not done.
- **Sources that don't work from GitHub runners:** Opportunity Desk returns 403 to GitHub runners, so it adds nothing there. The L'Oréal Brandstorm page returns 403 to the watcher. Both are recorded as warnings.
- **Fetch job colour:** `fetch.yml` goes red only if both sections (case comps and hackathons) fail. Each section has its own status row shown as a banner.
- **Open review notes (minor, post-cutover):**
  - pin Actions to commit SHAs;
  - send `frame-ancestors` from nginx;
  - teams survive their listing being pruned (by design), shown under the archived title.
