import "server-only";

import { isUsableInstallation } from "@/lib/requests/installation-usability";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Workspace } from "@/types/workspace";

/** Looks up a workspace by its Slack team ID, regardless of installation status. Returns null only for a team ApproveFlow has never seen. Use this for OAuth, lifecycle events, and any read of historical data that doesn't require a usable Slack token — see getUsableInstallation() below for that case. */
export async function findWorkspaceBySlackTeamId(slackTeamId: string): Promise<Workspace | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("workspaces").select("*").eq("slack_team_id", slackTeamId).maybeSingle();

  if (error) {
    throw new Error(`Failed to look up workspace: ${error.message}`);
  }
  return data;
}

/** M10.2: looks up a workspace by its internal UUID — used by the billing-session checkout page, which only ever carries a workspace_id (verified inside a signed token), never a Slack team ID. Returns null for an unknown or since-deleted workspace. */
export async function findWorkspaceById(workspaceId: string): Promise<Workspace | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("workspaces").select("*").eq("id", workspaceId).maybeSingle();

  if (error) {
    throw new Error(`Failed to look up workspace: ${error.message}`);
  }
  return data;
}

/** A Workspace known to have a decryptable bot token — see getUsableInstallation(). */
export interface UsableWorkspace extends Workspace {
  bot_access_token_ciphertext: string;
  bot_access_token_iv: string;
  bot_access_token_auth_tag: string;
}

/**
 * M8.1: the single, centralized "is this Slack installation currently
 * usable" check — used by every call site that is about to decrypt a bot
 * token or call the Slack Web API (slash commands, interactions, outbound
 * notifications, app_home_opened). Fails closed: returns null unless
 * `installation_status === 'INSTALLED'` AND all three encrypted-token
 * components are present, treating an unknown workspace, an uninstalled
 * one, a token-revoked one, and a corrupt/partial token row identically —
 * "not currently usable."
 *
 * Do NOT use this for: OAuth (it's the one place allowed to transition a
 * workspace INTO 'INSTALLED', so depending on this guard would be
 * circular), lifecycle event handling (app_uninstalled/tokens_revoked must
 * be able to look up and update a workspace regardless of its current
 * status), or any read of historical DB data that never touches the Slack
 * API — uninstalling a workspace must never make its history unreadable,
 * only prevent new Slack API activity. Use the plain lookup above for those.
 */
export async function getUsableInstallation(slackTeamId: string): Promise<UsableWorkspace | null> {
  const workspace = await findWorkspaceBySlackTeamId(slackTeamId);
  return isUsableInstallation(workspace) ? workspace : null;
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
