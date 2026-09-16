import { WebClient } from "@slack/web-api";
import { after } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env.server";
import { createRequestTimer, type RequestTimer } from "@/lib/observability/timing";
import { buildAppHomeView, HOME_RECENT_REQUESTS_LIMIT } from "@/lib/requests/build-app-home-view";
import { computeInstallationTransition, type InstallationEvent, type InstallationTransitionResult } from "@/lib/requests/compute-installation-transition";
import { listRequestsByRequester, listRequestsWaitingForApprover } from "@/lib/requests/request-views";
import { findWorkspaceBySlackTeamId, getUsableInstallation, upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { parseSlackEvent, type SlackEventEnvelope } from "@/lib/slack/parse-slack-event";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import { isValidSlackRequest } from "@/lib/slack/verify-request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const ack = () => new Response(null, { status: 200 });

/**
 * M8.1: publishes the Home tab for a viewer, fully independent of the HTTP
 * response — see handlePOST below for why this is safe to run in after().
 * A redelivered app_home_opened simply republishes the same view again;
 * views.publish always replaces the prior view wholesale, so redelivery is
 * a harmless no-op, never a duplicate side effect.
 */
async function publishHomeView(timer: RequestTimer, slackTeamId: string, slackUserId: string): Promise<void> {
  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    // Uninstalled, token-revoked, or an event for a team we've never seen —
    // nothing to publish to, and nothing we could publish with anyway.
    return;
  }

  const viewer = await timer.time("db", "upsertSlackUser", () => upsertSlackUser(workspace.id, slackUserId));

  const [{ rows: recentRequests, totalCount: myRequestsTotalCount }, waitingRequests] = await timer.time("db", "listRequestsForHome", () =>
    Promise.all([
      listRequestsByRequester(workspace.id, viewer.id, HOME_RECENT_REQUESTS_LIMIT),
      listRequestsWaitingForApprover(workspace.id, viewer.id),
    ]),
  );

  const view = buildAppHomeView({ recentRequests, myRequestsTotalCount, waitingCount: waitingRequests.length });

  const botToken = decryptBotToken({
    ciphertext: workspace.bot_access_token_ciphertext,
    iv: workspace.bot_access_token_iv,
    authTag: workspace.bot_access_token_auth_tag,
  });
  const client = new WebClient(botToken);
  await timer.time("slack_api", "views.publish", () => client.views.publish({ user_id: slackUserId, view } as Parameters<typeof client.views.publish>[0]));
}

/**
 * Applies a computed installation-lifecycle transition to a workspace row.
 * The decision of WHAT to change is entirely computeInstallationTransition's
 * (pure, unit tested) responsibility — this is only the DB-write glue.
 */
async function applyInstallationTransition(supabase: SupabaseClient, workspaceId: string, transition: InstallationTransitionResult): Promise<void> {
  const update: Record<string, unknown> = { installation_status: transition.nextStatus };
  if (transition.shouldSetUninstalledAt) {
    update.uninstalled_at = new Date().toISOString();
  }
  if (transition.shouldClearToken) {
    update.bot_access_token_ciphertext = null;
    update.bot_access_token_iv = null;
    update.bot_access_token_auth_tag = null;
  }

  const { error } = await supabase.from("workspaces").update(update).eq("id", workspaceId);
  if (error) {
    throw new Error(`Failed to apply installation transition: ${error.message}`);
  }
}

/**
 * Shared by app_uninstalled and tokens_revoked: resolve the workspace
 * (regardless of its current status — a plain lookup, never the
 * usable-installation guard, since processing a lifecycle event must work
 * even for an already-uninstalled/token-revoked workspace), compute the
 * transition, and apply it. Idempotent by construction: redelivering the
 * same event recomputes the same (or a no-op) transition every time — see
 * compute-installation-transition.ts's own tests for the exhaustive
 * combinations this relies on.
 */
async function handleInstallationEvent(timer: RequestTimer, slackTeamId: string, event: InstallationEvent): Promise<void> {
  const workspace = await timer.time("db", "findWorkspace", () => findWorkspaceBySlackTeamId(slackTeamId));
  if (!workspace) {
    // A lifecycle event for a team we've never recorded — nothing to update.
    return;
  }

  const transition = computeInstallationTransition({ currentStatus: workspace.installation_status, event });
  const supabase = getSupabaseAdmin();
  await timer.time("db", "applyInstallationTransition", () => applyInstallationTransition(supabase, workspace.id, transition));
}

/**
 * Handles tokens_revoked specifically: unlike app_uninstalled, this event
 * does NOT prove the whole app installation is gone — it lists revoked
 * token identifiers, and this app stores exactly one bot token per
 * workspace (no per-user OAuth tokens are ever issued/stored). Slack's
 * payload identifies a revoked bot token by its *bot user id*
 * (`event.tokens.bot`), which we already store as `workspace.bot_user_id`
 * from the original OAuth response — so a safe, conservative match is:
 * "does the revoked list include OUR stored bot_user_id?" If our
 * bot_user_id is missing (defensive — should not happen for a bot-token
 * install) or simply not present in the revoked list (some unrelated
 * user's token was revoked), no change is made — inventing an identity
 * match beyond this would risk incorrectly disabling a working
 * installation over an unrelated event.
 */
async function handleTokensRevoked(timer: RequestTimer, slackTeamId: string, revokedBotUserIds: string[]): Promise<void> {
  const workspace = await timer.time("db", "findWorkspace", () => findWorkspaceBySlackTeamId(slackTeamId));
  if (!workspace) {
    return;
  }
  if (!workspace.bot_user_id || !revokedBotUserIds.includes(workspace.bot_user_id)) {
    // Conservative no-op: this event doesn't prove OUR bot installation's
    // token was the one revoked.
    return;
  }

  const transition = computeInstallationTransition({ currentStatus: workspace.installation_status, event: "tokens_revoked" });
  const supabase = getSupabaseAdmin();
  await timer.time("db", "applyInstallationTransition", () => applyInstallationTransition(supabase, workspace.id, transition));
}

/**
 * Slack Events API endpoint (M6; extended M8.1 for app_uninstalled/
 * tokens_revoked). Same signing scheme as every other Slack surface (see
 * verify-request.ts) — verified before any trusted processing, including
 * the url_verification handshake itself.
 *
 * M8.1: every event_callback kind now ACKs immediately after signature
 * verification and envelope parsing, deferring all DB reads/writes and
 * Slack Web API calls to next/server's after(). None of these flows carry
 * a trigger_id and none of Slack's response-body semantics depend on this
 * work completing synchronously, so there is no correctness reason to keep
 * it pre-ack (see the M8.1 audit) — a redelivered event is safe to process
 * again either way (views.publish fully replaces; the lifecycle transition
 * is idempotent by construction).
 *
 * X-Slack-Retry-Num/X-Slack-Retry-Reason are recorded as observational
 * timing metadata only — never used to skip processing. Correctness comes
 * from idempotent handling of every event kind, not from assuming Slack
 * delivers exactly once.
 */
export async function POST(request: NextRequest) {
  const retryNum = request.headers.get("x-slack-retry-num");
  const retryReason = request.headers.get("x-slack-retry-reason");

  const rawBody = await request.text();

  const isValid = isValidSlackRequest({
    signingSecret: serverEnv.SLACK_SIGNING_SECRET ?? "",
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });
  if (!isValid) {
    return new Response("Unauthorized", { status: 401 });
  }

  let envelope: SlackEventEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return ack();
  }

  const parsed = parseSlackEvent(envelope);
  const timer = createRequestTimer("events", parsed.kind);
  if (retryNum) {
    // Metadata only, attached to the ack summary line below via a
    // dedicated afterTask-independent log — kept out of the hot path.
    console.log(JSON.stringify({ event: "timing", requestId: timer.requestId, route: "events", flow: parsed.kind, retryNum, retryReason }));
  }

  if (parsed.kind === "url_verification") {
    timer.ack("url_verification");
    return Response.json({ challenge: parsed.challenge });
  }

  if (parsed.kind === "ignored") {
    timer.ack("ignored");
    return ack();
  }

  if (parsed.kind === "app_home_opened") {
    const { slackTeamId, slackUserId } = parsed;
    timer.ack("accepted");
    after(() =>
      timer.afterTask("publishHomeView", async () => {
        try {
          await publishHomeView(timer, slackTeamId, slackUserId);
        } catch (error) {
          console.error("Failed to publish App Home view:", error instanceof Error ? error.message : "unknown error");
        }
      }),
    );
    return ack();
  }

  if (parsed.kind === "app_uninstalled") {
    const { slackTeamId } = parsed;
    timer.ack("accepted");
    after(() =>
      timer.afterTask("handleAppUninstalled", async () => {
        try {
          await handleInstallationEvent(timer, slackTeamId, "app_uninstalled");
        } catch (error) {
          console.error("Failed to process app_uninstalled:", error instanceof Error ? error.message : "unknown error");
        }
      }),
    );
    return ack();
  }

  // tokens_revoked
  const { slackTeamId, revokedBotUserIds } = parsed;
  timer.ack("accepted");
  after(() =>
    timer.afterTask("handleTokensRevoked", async () => {
      try {
        await handleTokensRevoked(timer, slackTeamId, revokedBotUserIds);
      } catch (error) {
        console.error("Failed to process tokens_revoked:", error instanceof Error ? error.message : "unknown error");
      }
    }),
  );
  return ack();
}
