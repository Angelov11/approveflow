import "server-only";

import { WebClient } from "@slack/web-api";

import { buildRequesterDecisionNotification } from "@/lib/requests/build-requester-decision-notification";
import type { RequestTiming } from "@/lib/requests/request-timing";
import type { UsableWorkspace } from "@/lib/requests/workspace-lookup";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface NotifyRequesterOfDecisionParams {
  /** Must already be confirmed usable (see getUsableInstallation) — this function decrypts unconditionally, never re-checks installation status itself. */
  workspace: UsableWorkspace;
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  /** The Slack user whose click caused this final transition — resolved server-side from the trusted, signature-verified payload, never the button contents. */
  decidingApproverSlackId: string;
}

/**
 * Best-effort, same posture as notify-approvers.ts: a Slack delivery
 * failure here must never affect the already-committed decision. The
 * caller only invokes this when decide_on_request() itself reported an
 * actual approved/rejected transition (see isFinalDecisionTransition) —
 * this function does no gating of its own, since the RPC outcome is the
 * single source of truth for "did this interaction just finalize the
 * request".
 *
 * Requester identity is resolved fresh from the request row's
 * requester_id, never from the button payload — the clicking user and the
 * original requester are different people by construction (the button
 * payload only ever identifies the clicker, who already passed
 * decide_on_request's own authorization check).
 *
 * Known limitation: if the process crashes between decide_on_request()
 * committing and this call completing, the notification is lost with no
 * retry — the same accepted tradeoff already documented for
 * notify-approvers.ts (no queue/outbox in M4).
 */
export async function notifyRequesterOfDecision({
  workspace,
  requestId,
  decision,
  decidingApproverSlackId,
}: NotifyRequesterOfDecisionParams): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select(
      "resource, requested_duration_minutes, requested_start_date, requested_start_time, requested_end_date, requested_end_time, requested_amount, requested_currency, routing_type, requester_id, request_type_id",
    )
    .eq("id", requestId)
    .single();

  if (requestError || !request) {
    console.error("Failed to load request for requester notification:", requestError?.message ?? "not found");
    return;
  }

  const [requesterResult, requestTypeResult, decisionCommentResult] = await Promise.all([
    supabase.from("users").select("slack_user_id").eq("id", request.requester_id).single(),
    supabase.from("request_types").select("name").eq("id", request.request_type_id).single(),
    // The comment belonging to THIS final transition: the (unique) REJECTED
    // row for a rejection, or the most recent APPROVED row for an approval
    // — the one that just crossed the required threshold, which for DIRECT
    // is also the only row that will ever exist.
    supabase
      .from("approvals")
      .select("comment")
      .eq("request_id", requestId)
      .eq("decision", decision)
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (requesterResult.error || !requesterResult.data) {
    console.error("Failed to resolve requester for notification:", requesterResult.error?.message ?? "not found");
    return;
  }
  if (requestTypeResult.error || !requestTypeResult.data) {
    console.error("Failed to resolve request type for notification:", requestTypeResult.error?.message ?? "not found");
    return;
  }
  if (decisionCommentResult.error) {
    console.error("Failed to resolve decision comment for notification:", decisionCommentResult.error.message);
    return;
  }

  let botToken: string;
  try {
    botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
  } catch (error) {
    console.error("Failed to decrypt bot token for requester notification:", error instanceof Error ? error.message : "unknown error");
    return;
  }

  const timing: RequestTiming = {
    startDate: request.requested_start_date,
    startTime: request.requested_start_time,
    endDate: request.requested_end_date,
    endTime: request.requested_end_time,
  };

  const content = buildRequesterDecisionNotification({
    decision,
    requestTypeName: requestTypeResult.data.name,
    resource: request.resource,
    timing,
    legacyDurationMinutes: request.requested_duration_minutes,
    expense: { amount: request.requested_amount, currency: request.requested_currency },
    routingType: request.routing_type,
    decidingApproverSlackId,
    comment: decisionCommentResult.data?.comment ?? null,
  });

  const client = new WebClient(botToken);
  try {
    await client.chat.postMessage(
      { channel: requesterResult.data.slack_user_id, ...content } as Parameters<typeof client.chat.postMessage>[0],
    );
  } catch (error) {
    console.error("Failed to notify requester of decision:", error instanceof Error ? error.message : "unknown error");
  }
}
