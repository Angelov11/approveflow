import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { REQUEST_MODAL_CALLBACK_ID } from "@/lib/requests/build-request-modal";
import { listActiveRequestTypes } from "@/lib/requests/request-types";
import { validateRequestSubmission, type ViewSubmissionPayload } from "@/lib/requests/validate-request-submission";
import { findWorkspaceBySlackTeamId, upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isValidSlackRequest } from "@/lib/slack/verify-request";

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

  let payload: ViewSubmissionPayload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return ack();
  }

  // Only view_submission for our modal is handled in M2 — anything else
  // (other interaction types, other callback_ids) is acknowledged as a no-op.
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
  const { error } = await supabase.from("requests").insert({
    workspace_id: workspace.id,
    requester_id: requester.id,
    request_type_id: requestType.id,
    resource: result.data.resource,
    reason: result.data.reason,
    requested_duration_minutes: result.data.requestedDurationMinutes,
    status: "PENDING",
    idempotency_key: result.data.idempotencyKey,
  });

  if (error && error.code !== POSTGRES_UNIQUE_VIOLATION) {
    console.error("Failed to persist request:", error.message);
    return modalErrors({ request_type_block: "Something went wrong saving your request. Please try again." });
  }
  // A unique violation on idempotency_key means this exact submission was
  // already persisted (e.g. Slack retried the HTTP delivery) — treat it as
  // success rather than erroring or inserting a duplicate.

  // Empty body closes the modal normally.
  return ack();
}
