import { WebClient } from "@slack/web-api";
import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { decideOnRequest } from "@/lib/requests/approval-actions";
import { describeDecisionOutcome, replaceActionsWithStatus } from "@/lib/requests/build-approval-notification";
import { REQUEST_MODAL_CALLBACK_ID } from "@/lib/requests/build-request-modal";
import { notifyApprovers } from "@/lib/requests/notify-approvers";
import { parseApprovalBlockAction, type BlockActionsPayload } from "@/lib/requests/parse-block-action";
import { listActiveRequestTypes } from "@/lib/requests/request-types";
import { validateRequestSubmission, type ViewSubmissionPayload } from "@/lib/requests/validate-request-submission";
import { findWorkspaceBySlackTeamId, upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import { isValidSlackRequest } from "@/lib/slack/verify-request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function modalErrors(errors: Record<string, string>) {
  return Response.json({ response_action: "errors", errors });
}

const ack = () => new Response(null, { status: 200 });

export async function POST(request: NextRequest) {
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

  const form = new URLSearchParams(rawBody);
  const rawPayload = form.get("payload");
  if (!rawPayload) {
    return ack();
  }

  let payload: { type?: string };
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return ack();
  }

  if (payload.type === "block_actions") {
    return handleApprovalAction(payload as BlockActionsPayload);
  }

  return handleRequestSubmission(payload as ViewSubmissionPayload);
}

async function handleRequestSubmission(payload: ViewSubmissionPayload): Promise<Response> {
  // Only view_submission for our modal is handled — anything else (other
  // interaction types, other callback_ids) is acknowledged as a no-op.
  if (payload.type !== "view_submission" || payload.view?.callback_id !== REQUEST_MODAL_CALLBACK_ID) {
    return ack();
  }

  // Re-resolve workspace/user from the trusted, signature-verified payload
  // envelope (payload.team.id / payload.user.id) — never from
  // private_metadata, which is only used here to carry the idempotency key.
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!slackTeamId || !slackUserId) {
    return modalErrors({ request_type_block: "Could not identify the Slack workspace or user. Please try again." });
  }

  const workspace = await findWorkspaceBySlackTeamId(slackTeamId);
  if (!workspace) {
    return modalErrors({ request_type_block: "ApproveFlow isn't installed for this workspace anymore." });
  }

  const requestTypes = await listActiveRequestTypes(workspace.id);
  const result = validateRequestSubmission(payload, { validRequestTypeKeys: requestTypes.map((type) => type.key) });
  if (!result.ok) {
    return modalErrors(result.errors);
  }

  const requester = await upsertSlackUser(workspace.id, result.data.slackUserId);
  const requestType = requestTypes.find((type) => type.key === result.data.requestTypeKey);
  if (!requestType) {
    // Race: the type could have been deactivated between listing it above and here.
    return modalErrors({ request_type_block: "That request type is no longer available. Please try again." });
  }

  const supabase = getSupabaseAdmin();
  const { data: inserted, error } = await supabase
    .from("requests")
    .insert({
      workspace_id: workspace.id,
      requester_id: requester.id,
      request_type_id: requestType.id,
      resource: result.data.resource,
      reason: result.data.reason,
      requested_duration_minutes: result.data.requestedDurationMinutes,
      status: "PENDING",
      idempotency_key: result.data.idempotencyKey,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      // This exact submission was already persisted (e.g. Slack retried the
      // HTTP delivery) — treat as success, and do NOT notify approvers
      // again for a retry.
      return ack();
    }
    console.error("Failed to persist request:", error.message);
    return modalErrors({ request_type_block: "Something went wrong saving your request. Please try again." });
  }

  // Best-effort notification — see notify-approvers.ts for why a failure
  // here can't roll back or fail the response for the already-created,
  // already-committed request.
  try {
    await notifyApprovers({
      workspace,
      requestId: inserted.id,
      requestTypeId: requestType.id,
      requestTypeName: requestType.name,
      resource: result.data.resource,
      reason: result.data.reason,
      requestedDurationMinutes: result.data.requestedDurationMinutes,
      requester: { slack_user_id: result.data.slackUserId, display_name: null },
    });
  } catch (notifyError) {
    console.error("Unexpected error notifying approvers:", notifyError instanceof Error ? notifyError.message : "unknown error");
  }

  // Empty body closes the modal normally.
  return ack();
}

async function handleApprovalAction(payload: BlockActionsPayload): Promise<Response> {
  const parsed = parseApprovalBlockAction(payload);
  if (!parsed.ok) {
    // Not one of our recognized actions, or malformed — ignore safely.
    return ack();
  }
  const { slackTeamId, slackUserId, actionId, requestId, channelId, messageTs, messageBlocks } = parsed.data;

  const workspace = await findWorkspaceBySlackTeamId(slackTeamId);
  if (!workspace) {
    return ack();
  }

  const approver = await upsertSlackUser(workspace.id, slackUserId);
  const decision = actionId === "approve_request" ? "APPROVED" : "REJECTED";

  let result;
  try {
    result = await decideOnRequest({ requestId, approverId: approver.id, decision });
  } catch (error) {
    console.error("Failed to record approval decision:", error instanceof Error ? error.message : "unknown error");
    return ack();
  }

  // Best-effort: update the clicking approver's own message so their button
  // can't be reused as though still pending. A failure here doesn't affect
  // the decision already committed above.
  try {
    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
    const client = new WebClient(botToken);
    const statusText = describeDecisionOutcome(result);
    await client.chat.update(
      {
        channel: channelId,
        ts: messageTs,
        text: statusText,
        blocks: replaceActionsWithStatus(messageBlocks, statusText),
      } as Parameters<typeof client.chat.update>[0],
    );
  } catch (error) {
    console.error("Failed to update Slack message after decision:", error instanceof Error ? error.message : "unknown error");
  }

  return ack();
}
