// The Supabase project behind every page and job. Both values are public by
// design: the publishable key alone reads nothing (no anon access to any
// table or function, supabase/v3.sql). Pages sign in with Google
// (lib/auth.js) and every request carries that member's session, so RLS
// decides what they see and write. The Actions jobs use the secret key from
// the SUPABASE_SERVICE_KEY repository secret, never this one.
export const SUPABASE_URL = 'https://hjgfowgswqafrhlqbuse.supabase.co';
// The publishable key (kept under its old name; supabase/check-access.mjs imports it).
export const SUPABASE_ANON_KEY = 'sb_publishable_p7F8PrYs50b95BeKlR3mfw_wYXprsg5';
