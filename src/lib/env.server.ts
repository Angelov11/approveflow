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
  /** Not consumed yet — reserved for verifying inbound Slack request signatures once M2 adds endpoints that receive them (events, interactions, slash commands). */
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  /** Base64-encoded, 32-byte random key. See src/lib/crypto/token-cipher.ts for the AES-256-GCM usage. */
  SLACK_TOKEN_ENCRYPTION_KEY: process.env.SLACK_TOKEN_ENCRYPTION_KEY,
} as const;
