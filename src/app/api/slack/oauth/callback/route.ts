import { WebClient } from "@slack/web-api";
import { NextRequest, NextResponse } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { createRequestTimer } from "@/lib/observability/timing";
import { getInstaller, getOAuthRedirectUri } from "@/lib/slack/install-provider";
import { encryptBotToken } from "@/lib/slack/token-encryption";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Known, non-sensitive failure reasons surfaced to /slack/installed. Never pass raw error/exception text through. */
type FailureReason =
  | "access_denied"
  | "slack_error"
  | "missing_params"
  | "invalid_state"
  | "exchange_failed"
  | "incomplete_response"
  | "storage_failed";

function redirectToResult(request: NextRequest, status: "success" | "error", reason?: FailureReason) {
  const url = new URL("/slack/installed", request.nextUrl.origin);
  url.searchParams.set("status", status);
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const timer = createRequestTimer("oauth_callback", "install_or_reinstall");
  const { searchParams } = request.nextUrl;

  // 1. Slack reports OAuth errors (e.g. the user clicked "Deny") via ?error=...
  const slackError = searchParams.get("error");
  if (slackError) {
    timer.ack(slackError === "access_denied" ? "access_denied" : "slack_error");
    return redirectToResult(request, "error", slackError === "access_denied" ? "access_denied" : "slack_error");
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    timer.ack("missing_params");
    return redirectToResult(request, "error", "missing_params");
  }

  // 2. Validate state before doing anything else — this is our CSRF protection.
  // Fail closed: a missing stateStore must be treated as invalid, never skipped.
  const installer = getInstaller();
  if (!installer.stateStore) {
    timer.ack("invalid_state");
    return redirectToResult(request, "error", "invalid_state");
  }
  try {
    await installer.stateStore.verifyStateParam(new Date(), state);
  } catch {
    timer.ack("invalid_state");
    return redirectToResult(request, "error", "invalid_state");
  }

  // 3. Exchange the authorization code for tokens via the official Web API client.
  const client = new WebClient();
  let oauthResponse: Awaited<ReturnType<typeof client.oauth.v2.access>>;
  try {
    oauthResponse = await timer.time("slack_api", "oauth.v2.access", () =>
      client.oauth.v2.access({
        client_id: serverEnv.SLACK_CLIENT_ID ?? "",
        client_secret: serverEnv.SLACK_CLIENT_SECRET ?? "",
        code,
        redirect_uri: getOAuthRedirectUri(),
      }),
    );
  } catch (error) {
    // Never log the request/response bodies here — they can carry tokens.
    console.error("Slack OAuth token exchange failed:", error instanceof Error ? error.message : "unknown error");
    timer.ack("exchange_failed");
    return redirectToResult(request, "error", "exchange_failed");
  }

  const accessToken = oauthResponse.access_token;
  const teamId = oauthResponse.team?.id;
  if (!accessToken || !teamId) {
    timer.ack("incomplete_response");
    return redirectToResult(request, "error", "incomplete_response");
  }

  // 4. Encrypt before persisting. Plaintext tokens never reach the database or logs.
  const encryptedToken = encryptBotToken(accessToken);

  // 5. M9: install_or_reinstall_workspace() atomically persists the Slack
  // installation AND, only for a genuinely brand-new workspace, bootstraps
  // the human OAuth installer as the first ApproveFlow admin — in the same
  // transaction, so there is no window where the workspace exists with zero
  // admins because a follow-up insert never ran. `authed_user.id` (present
  // in oauth.v2.access's response even for a bot-scopes-only install — see
  // the M9 audit) is the ONLY source of installer identity ever used here;
  // `bot_user_id` identifies the app's own bot account, never a human, and
  // is never treated as an admin candidate. A reinstall (existing
  // workspace, any prior installation_status) only updates installation/
  // token fields — workspace_admins is never touched in that branch, see
  // the migration for the exact mechanism.
  const supabase = getSupabaseAdmin();
  const { data: rpcData, error: dbError } = await timer.time("db", "installOrReinstallWorkspace", async () =>
    supabase.rpc("install_or_reinstall_workspace", {
      p_slack_team_id: teamId,
      p_slack_enterprise_id: oauthResponse.enterprise?.id ?? null,
      p_slack_app_id: oauthResponse.app_id ?? null,
      p_name: oauthResponse.team?.name ?? null,
      p_bot_user_id: oauthResponse.bot_user_id ?? null,
      p_bot_access_token_ciphertext: encryptedToken.ciphertext,
      p_bot_access_token_iv: encryptedToken.iv,
      p_bot_access_token_auth_tag: encryptedToken.authTag,
      p_installer_slack_user_id: oauthResponse.authed_user?.id ?? null,
    }),
  );

  if (dbError) {
    console.error("Failed to persist Slack installation:", dbError.message);
    timer.ack("storage_failed");
    return redirectToResult(request, "error", "storage_failed");
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!result) {
    console.error("install_or_reinstall_workspace returned no result");
    timer.ack("storage_failed");
    return redirectToResult(request, "error", "storage_failed");
  }

  timer.ack(result.is_new_workspace ? "success_new_workspace" : "success_reinstall");
  return redirectToResult(request, "success");
}
