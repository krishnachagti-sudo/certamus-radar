# vendor/

`supabase.js` is the UMD build of the official
[`@supabase/supabase-js`](https://www.npmjs.com/package/@supabase/supabase-js)
client, pinned and served from this repo (no CDN; it fits the pages'
`script-src 'self'`). Every page loads it as a classic script before its
module; it defines `window.supabase` (`lib/auth.js` calls `createClient`).

| | |
|---|---|
| Package | `@supabase/supabase-js` |
| Version | `2.117.2` (npm `latest` on 2026-10-05) |
| File | `package/dist/umd/supabase.js` from the npm tarball |
| sha256 | `59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd` |
| npm tarball integrity | `sha512-eSG2VKnHR+Clp1PmidZ1/weJ8PJwoybjva3L2GgKqFG4YDS1Iqmc61psKGZP5xw6OMT2O7ZorPR42PY6q1BOXg==` |

Verified on 2026-10-05: the tarball from `npm pack @supabase/supabase-js@2.117.2`
matched the registry's `dist.integrity`, and the file's sha256 matched the
same version's `dist/umd/supabase.js` on cdn.jsdelivr.net. `test/vendor.test.js`
checks the sha256 above on every `npm test`.

To upgrade: `npm pack @supabase/supabase-js@<version>`, check the tarball's
sha512 against `npm view @supabase/supabase-js@<version> dist.integrity`,
copy `package/dist/umd/supabase.js` here, and update the table and the hash
in `test/vendor.test.js`.
