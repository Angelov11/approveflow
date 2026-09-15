import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Workspace } from "@/types/workspace";

/** Looks up an installed workspace by its Slack team ID. Returns null for unknown/uninstalled workspaces — callers must reject those, never assume installation. */
export async function findWorkspaceBySlackTeamId(slackTeamId: string): Promise<Workspace | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("workspaces").select("*").eq("slack_team_id", slackTeamId).maybeSingle();

  if (error) {
    throw new Error(`Failed to look up workspace: ${error.message}`);
  }
  return data;
}

/** Idempotent upsert of a Slack user scoped to a workspace. Returns the user's internal id. */
export async function upsertSlackUser(workspaceId: string, slackUserId: string): Promise<{ id: string }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .upsert(
      { workspace_id: workspaceId, slack_user_id: slackUserId },
      { onConflict: "workspace_id,slack_user_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert Slack user: ${error?.message ?? "no row returned"}`);
  }
  return data;
}
