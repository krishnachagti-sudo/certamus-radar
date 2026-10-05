// The Radar API every page talks to (api/, deployed on Railway). Public by
// design: it holds no secret, and the API answers nothing without a
// signed-in member's session token (or the jobs' service token, which lives
// only in GitHub and Railway secrets). Pages sign in with Google through it
// (lib/auth.js); the database decides what each person sees and writes.
//
// CHANGE THIS at cutover to the API service's real public URL (Railway →
// the api service → Settings → Networking), with no trailing slash. Every
// page's Content-Security-Policy connect-src must name the same origin
// (test/pages.test.js checks that they match).
export const API_URL = 'https://certamus-radar-api.up.railway.app';
