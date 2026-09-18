import "server-only";

import { publicEnv } from "@/lib/env";

/**
 * Server-only environment configuration. Importing "server-only" makes any
 * accidental import of this module from client component code fail the
 * build, so SUPABASE_SERVICE_ROLE_KEY can never end up in browser JS.
 */
export const serverEnv = {
  ...publicEnv,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
  /** Verifies inbound Slack request signatures (slash command + interactions routes). */
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  /** Base64-encoded, 32-byte random key. See src/lib/crypto/token-cipher.ts for the AES-256-GCM usage. */
  SLACK_TOKEN_ENCRYPTION_KEY: process.env.SLACK_TOKEN_ENCRYPTION_KEY,

  /** M10.2: "sandbox" or "live" — must match which environment PADDLE_API_KEY/NEXT_PUBLIC_PADDLE_CLIENT_TOKEN belong to. See paddle-environment-guard.ts. */
  PADDLE_ENVIRONMENT: process.env.PADDLE_ENVIRONMENT,
  /** Secret — server-only. Sandbox prefix pdl_sdbx_apikey_; live prefix pdl_live_apikey_. Never sent to the browser. */
  PADDLE_API_KEY: process.env.PADDLE_API_KEY,
  /** Server-only, not secret — the Paddle Price ID (pri_...) for ApproveGo Pro's monthly subscription. Not needed client-side: the browser only ever receives a transactionId. */
  PADDLE_PRO_PRICE_ID: process.env.PADDLE_PRO_PRICE_ID,
} as const;
