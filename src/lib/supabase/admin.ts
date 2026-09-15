import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env.server";

let client: SupabaseClient | undefined;

/**
 * Full-access Supabase client using the service role key. Bypasses row
 * level security — server-only, and must never be imported into anything
 * that could end up in a client bundle.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (client) {
    return client;
  }

  const url = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use the Supabase admin client.");
  }

  client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
