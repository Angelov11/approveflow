import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { WorkspaceSubscription } from "@/types/billing";

/**
 * Looks up a workspace's current Paddle subscription row. Null means the
 * workspace is on Free — there is no explicit FREE row (see
 * supabase/migrations, M10.1). Written by a future webhook handler, not by
 * M10.1: this always returns null today.
 */
export async function findWorkspaceSubscription(workspaceId: string): Promise<WorkspaceSubscription | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("workspace_subscriptions").select("*").eq("workspace_id", workspaceId).maybeSingle();

  if (error) {
    throw new Error(`Failed to look up workspace subscription: ${error.message}`);
  }
  return data;
}
