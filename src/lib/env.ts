/**
 * Public, client-safe environment configuration.
 *
 * Only variables prefixed with NEXT_PUBLIC_ belong here — anything in this
 * file is bundled into browser JavaScript. Server-only secrets (e.g. the
 * Supabase service role key) must live in `env.server.ts` instead.
 */
export const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
} as const;
