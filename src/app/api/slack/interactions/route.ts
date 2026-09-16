import { randomUUID } from "node:crypto";

import { WebClient } from "@slack/web-api";
import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { decideOnRequest } from "@/lib/requests/approval-actions";
import { findActivePolicyForRequestType, listPolicyRecipients } from "@/lib/requests/approval-policies";
import { buildApprovalNotification, describeDecisionOutcome, replaceActionsWithStatus, APPROVE_ACTION_ID, REJECT_ACTION_ID } from "@/lib/requests/build-approval-notification";
import {
  APPROVE_DECISION_CALLBACK_ID,
  buildDecisionModal,
  REJECT_DECISION_CALLBACK_ID,
  type DecisionModalSource,
} from "@/lib/requests/build-decision-modal";
import { buildRequestModal, REQUEST_MODAL_CALLBACK_ID } from "@/lib/requests/build-request-modal";
import { buildErrorView, buildRequestCenterView, buildRequestDetailsView, buildWaitingListView, type ModalView } from "@/lib/requests/build-requests-views";
import { isFinalDecisionTransition } from "@/lib/requests/build-requester-decision-notification";
import { notifyApprovers, type NotificationRecipient } from "@/lib/requests/notify-approvers";
import { notifyRequesterOfDecision } from "@/lib/requests/notify-requester";
import { parseApprovalBlockAction, type BlockActionsPayload } from "@/lib/requests/parse-block-action";
import {
  CREATE_REQUEST_ACTION_ID,
  OPEN_REQUEST_CENTER_ACTION_ID,
  parseRequestsNavigationAction,
  VIEW_REQUEST_ACTION_ID,
  VIEW_WAITING_REQUESTS_ACTION_ID,
  type RequestsNavigationPayload,
} from "@/lib/requests/parse-requests-action";
import { getRequestDetails, listRequestsByRequester, listRequestsWaitingForApprover } from "@/lib/requests/request-views";
import { ensureDefaultRequestTypes, listActiveRequestTypes } from "@/lib/requests/request-types";
import { validateDecisionSubmission, type DecisionSubmissionPayload } from "@/lib/requests/validate-decision-submission";
import { validateRequestSubmission, type ViewSubmissionPayload } from "@/lib/requests/validate-request-submission";
import { findWorkspaceBySlackTeamId, upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import { isValidSlackRequest } from "@/lib/slack/verify-request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Decision } from "@/types/approval";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function modalErrors(errors: Record<string, string>) {
  return Response.json({ response_action: "errors", errors });
}

/** Replaces the currently-open view in place — used to show a small result/error view after a decision modal submission that couldn't be applied (already decided, unauthorized, etc.), rather than silently closing and doing nothing. */
function modalUpdate(view: ModalView) {
  return Response.json({ response_action: "update", view });
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

  let payload: { type?: string; actions?: { action_id?: string }[]; view?: { callback_id?: string } };
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return ack();
  }

  if (payload.type === "block_actions") {
    const actionId = payload.actions?.[0]?.action_id;
    if (actionId === APPROVE_ACTION_ID || actionId === REJECT_ACTION_ID) {
      return handleOpenDecisionModal(payload as BlockActionsPayload, actionId === APPROVE_ACTION_ID ? "APPROVED" : "REJECTED");
    }
    if (
      actionId === VIEW_REQUEST_ACTION_ID ||
      actionId === VIEW_WAITING_REQUESTS_ACTION_ID ||
      actionId === OPEN_REQUEST_CENTER_ACTION_ID ||
      actionId === CREATE_REQUEST_ACTION_ID
    ) {
      return handleRequestsNavigation(payload as RequestsNavigationPayload);
    }
    // Not one of our recognized actions — ignore safely.
    return ack();
  }

  if (payload.type === "view_submission") {
    const callbackId = payload.view?.callback_id;
    if (callbackId === REQUEST_MODAL_CALLBACK_ID) {
      return handleRequestSubmission(payload as ViewSubmissionPayload);
    }
    if (callbackId === APPROVE_DECISION_CALLBACK_ID || callbackId === REJECT_DECISION_CALLBACK_ID) {
      return handleDecisionSubmission(payload as DecisionSubmissionPayload, callbackId === REJECT_DECISION_CALLBACK_ID ? "REJECTED" : "APPROVED");
    }
    return ack();
  }

  return ack();
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

  // Routing is decided ONCE, here, and frozen on the row — never re-derived
  // later by asking "is there an active policy right now" (see the M4
  // migration adding these columns for why that would be unstable).
  //
  // Case A: an active policy exists → POLICY routing. The requester's
  // selected approver is resolved (so it's a valid workspace user) but
  // deliberately NOT persisted as though they were responsible for the
  // request — company policy takes precedence over a manual pick.
  //
  // Case B: no active policy → DIRECT routing, using exactly the selected
  // approver, requiring exactly 1 approval.
  const activePolicy = await findActivePolicyForRequestType(workspace.id, requestType.id);
  const directApprover = await upsertSlackUser(workspace.id, result.data.selectedApproverSlackId);

  const routingFields = activePolicy
    ? {
        routing_type: "POLICY" as const,
        approval_policy_id: activePolicy.id,
        direct_approver_id: null,
        required_approval_count: activePolicy.required_approvals,
      }
    : {
        routing_type: "DIRECT" as const,
        approval_policy_id: null,
        direct_approver_id: directApprover.id,
        required_approval_count: 1,
      };

  const supabase = getSupabaseAdmin();
  const { data: inserted, error } = await supabase
    .from("requests")
    .insert({
      workspace_id: workspace.id,
      requester_id: requester.id,
      request_type_id: requestType.id,
      resource: result.data.resource,
      // M8: "Reason" was merged into "Details" (resource) in the modal — the
      // column stays nullable and unpopulated for new requests rather than
      // duplicating the Details text into it. See validate-request-submission.ts.
      reason: null,
      // M8 correction: the fixed duration dropdown was replaced by the
      // requested_start_date/time and requested_end_date/time columns below
      // — this legacy column is retained only for historical rendering and
      // is never populated by a new request.
      requested_duration_minutes: null,
      requested_start_date: result.data.timing.startDate,
      requested_start_time: result.data.timing.startTime,
      requested_end_date: result.data.timing.endDate,
      requested_end_time: result.data.timing.endTime,
      status: "PENDING",
      idempotency_key: result.data.idempotencyKey,
      ...routingFields,
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
    const recipients: NotificationRecipient[] = activePolicy
      ? await listPolicyRecipients(activePolicy.id)
      : [{ slack_user_id: result.data.selectedApproverSlackId, display_name: null }];

    await notifyApprovers({
      workspace,
      requestId: inserted.id,
      requestTypeName: requestType.name,
      resource: result.data.resource,
      reason: null,
      timing: result.data.timing,
      requester: { slack_user_id: result.data.slackUserId, display_name: null },
      recipients,
    });
  } catch (notifyError) {
    console.error("Unexpected error notifying approvers:", notifyError instanceof Error ? notifyError.message : "unknown error");
  }

  // Empty body closes the modal normally.
  return ack();
}

/**
 * M7: an Approve/Reject click no longer decides anything itself — it only
 * opens a small modal (optional Comment for Approve, required Reason for
 * Reject) via the click's own trigger_id. Opening this modal grants no
 * authorization at all; the actual decision only happens in
 * handleDecisionSubmission below, which independently re-resolves and
 * re-authorizes through decide_on_request(). The click's `source` (message
 * vs. modal origin) travels forward via the decision modal's
 * private_metadata purely so the outcome can be reflected in the right
 * place afterward — never as an authorization signal.
 */
async function handleOpenDecisionModal(payload: BlockActionsPayload, decision: Decision): Promise<Response> {
  const parsed = parseApprovalBlockAction(payload);
  if (!parsed.ok) {
    // Not one of our recognized actions, or malformed — ignore safely.
    return ack();
  }
  const { slackTeamId, triggerId, requestId, source } = parsed.data;

  const workspace = await findWorkspaceBySlackTeamId(slackTeamId);
  if (!workspace) {
    return ack();
  }

  try {
    // Only the minimum locator needed to reflect the outcome later — never
    // the original message/view blocks, which could push private_metadata
    // over Slack's 3000-character limit for a request with a long
    // resource/reason (see build-decision-modal.ts).
    const modalSource: DecisionModalSource =
      source.type === "message"
        ? { type: "message", channelId: source.channelId, messageTs: source.messageTs }
        : { type: "modal", viewId: source.viewId };

    const view = buildDecisionModal({ decision, requestId, source: modalSource });

    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
    const client = new WebClient(botToken);

    // Message-origin: no modal is open yet, so this is a fresh top-level
    // modal (views.open). Modal-origin (M5 Request Details): stack the
    // decision modal on top of it (views.push) — Cancel then naturally
    // returns to Request Details, same convention as M6's origin-based
    // open/push branching.
    if (source.type === "modal") {
      await client.views.push({ trigger_id: triggerId, view } as Parameters<typeof client.views.push>[0]);
    } else {
      await client.views.open({ trigger_id: triggerId, view } as Parameters<typeof client.views.open>[0]);
    }
  } catch (error) {
    console.error("Failed to open decision modal:", error instanceof Error ? error.message : "unknown error");
  }

  return ack();
}

/**
 * Rebuilds the original approver DM's content fresh from the (immutable)
 * request row, rather than relying on blocks carried through
 * private_metadata — deterministic given the same request, and reused
 * verbatim with replaceActionsWithStatus exactly like the pre-M7 flow did
 * with the payload-echoed blocks. Workspace-scoped: returns null (not an
 * error) for a request that doesn't exist or belongs to a different
 * workspace, same safety posture as getRequestDetails.
 */
async function rebuildApprovalMessageContent(workspaceId: string, requestId: string) {
  const supabase = getSupabaseAdmin();
  const { data: request, error } = await supabase
    .from("requests")
    .select(
      "resource, reason, requested_duration_minutes, requested_start_date, requested_start_time, requested_end_date, requested_end_time, request_types(name), users!requests_requester_id_fkey(slack_user_id)",
    )
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !request) {
    return null;
  }

  const requestType = Array.isArray(request.request_types) ? request.request_types[0] : request.request_types;
  const requester = Array.isArray(request.users) ? request.users[0] : request.users;

  return buildApprovalNotification({
    requestId,
    requestTypeName: requestType?.name ?? "Unknown request type",
    requester: { slack_user_id: requester?.slack_user_id ?? "unknown", display_name: null },
    resource: request.resource,
    reason: request.reason,
    timing: {
      startDate: request.requested_start_date,
      startTime: request.requested_start_time,
      endDate: request.requested_end_date,
      endTime: request.requested_end_time,
    },
    legacyDurationMinutes: request.requested_duration_minutes,
  });
}

const DECISION_NOT_APPLIED_OUTCOMES = new Set(["not_found", "already_final", "unauthorized", "already_decided", "no_policy"]);

/**
 * The security-critical step (M7): submitting the decision modal does NOT
 * assume the user is still authorized just because they successfully
 * opened it. Workspace/user identity is re-resolved from the signed
 * `payload.team`/`payload.user` envelope (never from private_metadata),
 * and decide_on_request() independently re-authorizes from scratch —
 * this matters most for POLICY routing, where membership is live: someone
 * removed from a policy between opening and submitting this modal is
 * rejected here exactly as if they'd never opened it.
 */
async function handleDecisionSubmission(payload: DecisionSubmissionPayload, decision: Decision): Promise<Response> {
  const parsed = validateDecisionSubmission(payload, decision);
  if (!parsed.ok) {
    return modalErrors(parsed.errors);
  }
  const { slackTeamId, slackUserId, requestId, source, comment } = parsed.data;

  const workspace = await findWorkspaceBySlackTeamId(slackTeamId);
  if (!workspace) {
    return modalUpdate(buildErrorView("ApproveFlow isn't installed for this workspace anymore."));
  }

  let approverId: string;
  let result;
  try {
    const approver = await upsertSlackUser(workspace.id, slackUserId);
    approverId = approver.id;
    result = await decideOnRequest({ requestId, approverId, decision, comment });
  } catch (error) {
    console.error("Failed to record decision:", error instanceof Error ? error.message : "unknown error");
    return modalUpdate(buildErrorView("Something went wrong recording your decision. Please try again."));
  }

  if (DECISION_NOT_APPLIED_OUTCOMES.has(result.outcome)) {
    // Authorization/conflict outcome — nothing was recorded. Tell the user
    // why instead of silently closing the modal as if it had worked.
    return modalUpdate(buildErrorView(describeDecisionOutcome(result)));
  }

  // Best-effort: reflect the outcome where the click came from. A failure
  // here doesn't affect the decision already committed above. The button
  // could live in a posted DM (M3/M4) or in the M5 Request Details modal —
  // decide_on_request()/the decision itself is identical either way; only
  // how we show the result differs.
  try {
    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
    const client = new WebClient(botToken);
    const statusText = describeDecisionOutcome(result);

    if (source.type === "message") {
      const rebuilt = await rebuildApprovalMessageContent(workspace.id, requestId);
      if (rebuilt) {
        await client.chat.update(
          {
            channel: source.channelId,
            ts: source.messageTs,
            text: statusText,
            blocks: replaceActionsWithStatus(rebuilt.blocks, statusText),
          } as Parameters<typeof client.chat.update>[0],
        );
      }
    } else {
      const details = await getRequestDetails(workspace.id, requestId, approverId);
      const view = details ? buildRequestDetailsView({ details, banner: statusText }) : buildErrorView("This request could not be found.");
      await client.views.update({ view_id: source.viewId, view } as Parameters<typeof client.views.update>[0]);
    }
  } catch (error) {
    console.error("Failed to reflect decision outcome in Slack:", error instanceof Error ? error.message : "unknown error");
  }

  // Notify the original requester, but ONLY when THIS interaction actually
  // caused a final transition — never for retries/duplicates/already-final
  // requests/unauthorized attempts/intermediate policy approvals. Gating on
  // the RPC's own outcome (rather than e.g. re-checking request status)
  // means a Slack HTTP retry of the same submission — which decide_on_request
  // reports as "already_decided" — can never trigger a second notification.
  if (isFinalDecisionTransition(result.outcome)) {
    try {
      await notifyRequesterOfDecision({
        workspace,
        requestId,
        decision: result.outcome === "approved" ? "APPROVED" : "REJECTED",
        decidingApproverSlackId: slackUserId,
      });
    } catch (error) {
      console.error("Failed to notify requester of decision:", error instanceof Error ? error.message : "unknown error");
    }
  }

  // Empty body closes the decision modal — if it was pushed onto Request
  // Details, this pops back to that (now-updated) view underneath, same as
  // clicking Cancel would.
  return ack();
}

/**
 * Navigation within the /requests modal flow, AND from the App Home tab
 * (M6) — opening a request's details, pushing the full "Waiting for Me"
 * list, opening the Request Center, or opening a fresh "New Request" modal.
 * Never an authorization decision — just reads (plus, for Create Request,
 * the same idempotent bootstrap /request itself does).
 *
 * A modal-originated click appends to that modal's stack (views.push, M5
 * unchanged); a Home-originated click has no stack to append to and opens a
 * new top-level modal (views.open) — see the `origin` field on the parsed
 * result for why. Either way, the underlying view is built by the exact
 * same M5 functions.
 */
async function handleRequestsNavigation(payload: RequestsNavigationPayload): Promise<Response> {
  const parsed = parseRequestsNavigationAction(payload);
  if (!parsed.ok) {
    return ack();
  }
  const { slackTeamId, slackUserId, triggerId, origin } = parsed.data;

  const workspace = await findWorkspaceBySlackTeamId(slackTeamId);
  if (!workspace) {
    return ack();
  }

  try {
    const viewer = await upsertSlackUser(workspace.id, slackUserId);

    let view: ModalView;
    if (parsed.data.actionId === VIEW_WAITING_REQUESTS_ACTION_ID) {
      const waitingRequests = await listRequestsWaitingForApprover(workspace.id, viewer.id);
      view = buildWaitingListView({ waitingRequests });
    } else if (parsed.data.actionId === VIEW_REQUEST_ACTION_ID) {
      // Revalidates workspace ownership again inside getRequestDetails —
      // the request id from the button value is an opaque locator only.
      const details = await getRequestDetails(workspace.id, parsed.data.requestId, viewer.id);
      view = details ? buildRequestDetailsView({ details }) : buildErrorView("This request could not be found.");
    } else if (parsed.data.actionId === OPEN_REQUEST_CENTER_ACTION_ID) {
      const [{ rows: myRequests, totalCount }, waitingRequests] = await Promise.all([
        listRequestsByRequester(workspace.id, viewer.id),
        listRequestsWaitingForApprover(workspace.id, viewer.id),
      ]);
      view = buildRequestCenterView({ myRequests, myRequestsTotalCount: totalCount, waitingCount: waitingRequests.length });
    } else {
      // CREATE_REQUEST_ACTION_ID — mirrors /request's own bootstrap exactly,
      // since Home must work for a user who has never run any command
      // before.
      await ensureDefaultRequestTypes(workspace.id);
      const requestTypes = await listActiveRequestTypes(workspace.id);
      view = buildRequestModal({ requestTypes, idempotencyKey: randomUUID() });
    }

    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
    const client = new WebClient(botToken);
    if (origin === "home") {
      await client.views.open({ trigger_id: triggerId, view } as Parameters<typeof client.views.open>[0]);
    } else {
      await client.views.push({ trigger_id: triggerId, view } as Parameters<typeof client.views.push>[0]);
    }
  } catch (error) {
    console.error("Failed to open/push /requests navigation view:", error instanceof Error ? error.message : "unknown error");
  }

  return ack();
}
