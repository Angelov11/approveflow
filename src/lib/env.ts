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
  /** Canonical, fully-qualified app URL. Used to build Slack OAuth redirect URIs. */
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  /** M10.2: Paddle.js client-side token — browser-safe by design (test_/live_ prefix). Never the server-side PADDLE_API_KEY. */
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
} as const;
