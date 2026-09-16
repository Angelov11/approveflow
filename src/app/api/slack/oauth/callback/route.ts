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

  // 5. Upsert by slack_team_id so reinstalling updates the existing row instead
  // of duplicating it. M8.1: every successful OAuth completion — fresh install
  // OR reinstall after an uninstall/token-revocation — unconditionally sets
  // installation_status back to 'INSTALLED' and clears uninstalled_at. No
  // "is this a reinstall" branch is needed: upserting fixed values is
  // idempotent regardless of the row's prior state. first_installed_at is
  // deliberately not set here (and not a column at all — see the M8.1
  // migration) since installed_at already means "most recent install."
  const supabase = getSupabaseAdmin();
  const { error: dbError } = await timer.time("db", "upsertWorkspace", async () =>
    supabase.from("workspaces").upsert(
      {
        slack_team_id: teamId,
        slack_enterprise_id: oauthResponse.enterprise?.id ?? null,
        slack_app_id: oauthResponse.app_id ?? null,
        name: oauthResponse.team?.name ?? null,
        bot_user_id: oauthResponse.bot_user_id ?? null,
        bot_access_token_ciphertext: encryptedToken.ciphertext,
        bot_access_token_iv: encryptedToken.iv,
        bot_access_token_auth_tag: encryptedToken.authTag,
        installation_status: "INSTALLED",
        uninstalled_at: null,
        installed_at: new Date().toISOString(),
      },
      { onConflict: "slack_team_id" },
    ),
  );

  if (dbError) {
    console.error("Failed to persist Slack installation:", dbError.message);
    timer.ack("storage_failed");
    return redirectToResult(request, "error", "storage_failed");
  }

  timer.ack("success");
  return redirectToResult(request, "success");
}
