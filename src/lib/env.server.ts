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
} as const;
