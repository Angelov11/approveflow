import { randomUUID } from "node:crypto";

import { WebClient } from "@slack/web-api";
import { after } from "next/server";
import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { createRequestTimer, type RequestTimer } from "@/lib/observability/timing";
import { decideOnRequest } from "@/lib/requests/approval-actions";
import {
  handleAddAdministratorOpen,
  handleAddAdministratorSubmission,
  handleConfigurePolicyOpen,
  handleManageAdministrators,
  handleManagePolicies,
  handlePolicySubmission,
  handleRemoveAdministrator,
} from "@/lib/requests/admin-interaction-handlers";
import { findActivePolicyForRequestType, listPolicyRecipients } from "@/lib/requests/approval-policies";
import {
  ADD_ADMINISTRATOR_ACTION_ID,
  ADD_ADMINISTRATOR_CALLBACK_ID,
  MANAGE_ADMINISTRATORS_ACTION_ID,
  MANAGE_POLICIES_ACTION_ID,
  REMOVE_ADMINISTRATOR_ACTION_ID,
  CONFIGURE_POLICY_ACTION_ID,
} from "@/lib/requests/build-admin-views";
import { CONFIGURE_POLICY_CALLBACK_ID } from "@/lib/requests/build-policy-modal";
import type { PolicySubmissionPayload } from "@/lib/requests/validate-policy-submission";
import { buildApprovalNotification, describeDecisionOutcome, replaceActionsWithStatus, APPROVE_ACTION_ID, REJECT_ACTION_ID } from "@/lib/requests/build-approval-notification";
import {
  APPROVE_DECISION_CALLBACK_ID,
  buildDecisionModal,
  REJECT_DECISION_CALLBACK_ID,
  type DecisionModalSource,
} from "@/lib/requests/build-decision-modal";
import { buildRequestModal, REQUEST_MODAL_CALLBACK_ID, REQUEST_TYPE_SELECT_ACTION_ID, type PreservedRequestFields } from "@/lib/requests/build-request-modal";
import { buildErrorView, buildRequestCenterView, buildRequestDetailsView, buildWaitingListView, type ModalView } from "@/lib/requests/build-requests-views";
import { isFinalDecisionTransition } from "@/lib/requests/build-requester-decision-notification";
import { EXPENSE_AMOUNT_ACTION_ID, EXPENSE_AMOUNT_BLOCK_ID, EXPENSE_CURRENCY_ACTION_ID, EXPENSE_CURRENCY_BLOCK_ID } from "@/lib/requests/expense";
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
import { computeRequestRoutingDecision } from "@/lib/requests/compute-request-routing";
import { getRequestDetails, listRequestsByRequester, listRequestsWaitingForApprover } from "@/lib/requests/request-views";
import { getRequestTypeFieldConfig, remapExpenseForModeChange, remapTimingForModeChange } from "@/lib/requests/request-type-config";
import { ensureDefaultRequestTypes, listActiveRequestTypes } from "@/lib/requests/request-types";
import {
  END_DATE_ACTION_ID,
  END_DATE_BLOCK_ID,
  END_TIME_ACTION_ID,
  END_TIME_BLOCK_ID,
  START_DATE_ACTION_ID,
  START_DATE_BLOCK_ID,
  START_TIME_ACTION_ID,
  START_TIME_BLOCK_ID,
  type RequestTiming,
} from "@/lib/requests/request-timing";
import { validateDecisionSubmission, type DecisionSubmissionPayload } from "@/lib/requests/validate-decision-submission";
import { validateRequestSubmission, type ViewSubmissionPayload } from "@/lib/requests/validate-request-submission";
import { findWorkspaceBySlackTeamId, getUsableInstallation, upsertSlackUser } from "@/lib/requests/workspace-lookup";
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

/** Best-effort label for the ack summary line — never affects dispatch, only observability. */
function describeFlow(payload: { type?: string; actions?: { action_id?: string }[]; view?: { callback_id?: string } }): string {
  if (payload.type === "block_actions") {
    return payload.actions?.[0]?.action_id ?? "block_actions_unrecognized";
  }
  if (payload.type === "view_submission") {
    return payload.view?.callback_id ?? "view_submission_unrecognized";
  }
  return payload.type ?? "unrecognized";
}

export async function POST(request: NextRequest) {
  const verifyStart = performance.now();
  const rawBody = await request.text();

  const isValid = isValidSlackRequest({
    signingSecret: serverEnv.SLACK_SIGNING_SECRET ?? "",
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });
  const verifyMs = performance.now() - verifyStart;
  if (!isValid) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parseStart = performance.now();
  const form = new URLSearchParams(rawBody);
  const rawPayload = form.get("payload");
  if (!rawPayload) {
    return ack();
  }

  let payload: {
    type?: string;
    team?: { id?: string };
    user?: { id?: string };
    trigger_id?: string;
    actions?: { action_id?: string; value?: string }[];
    view?: { id?: string; type?: string; callback_id?: string };
  };
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return ack();
  }
  const parseMs = performance.now() - parseStart;

  const timer = createRequestTimer("interactions", describeFlow(payload));
  timer.markVerify(verifyMs);
  timer.markParse(parseMs);

  if (payload.type === "block_actions") {
    const actionId = payload.actions?.[0]?.action_id;
    if (actionId === APPROVE_ACTION_ID || actionId === REJECT_ACTION_ID) {
      return handleOpenDecisionModal(payload as BlockActionsPayload, actionId === APPROVE_ACTION_ID ? "APPROVED" : "REJECTED", timer);
    }
    if (
      actionId === VIEW_REQUEST_ACTION_ID ||
      actionId === VIEW_WAITING_REQUESTS_ACTION_ID ||
      actionId === OPEN_REQUEST_CENTER_ACTION_ID ||
      actionId === CREATE_REQUEST_ACTION_ID
    ) {
      return handleRequestsNavigation(payload as RequestsNavigationPayload, timer);
    }
    if (actionId === REQUEST_TYPE_SELECT_ACTION_ID) {
      return handleRequestTypeChanged(payload as RequestTypeChangedPayload, timer);
    }
    // M9: admin/policy management — see admin-interaction-handlers.ts.
    if (actionId === MANAGE_ADMINISTRATORS_ACTION_ID) {
      return handleManageAdministrators(payload, timer);
    }
    if (actionId === ADD_ADMINISTRATOR_ACTION_ID) {
      return handleAddAdministratorOpen(payload, timer);
    }
    if (actionId === REMOVE_ADMINISTRATOR_ACTION_ID) {
      return handleRemoveAdministrator(payload, timer);
    }
    if (actionId === MANAGE_POLICIES_ACTION_ID) {
      return handleManagePolicies(payload, timer);
    }
    if (actionId === CONFIGURE_POLICY_ACTION_ID) {
      return handleConfigurePolicyOpen(payload, timer);
    }
    // Not one of our recognized actions — ignore safely.
    timer.ack("ignored");
    return ack();
  }

  if (payload.type === "view_submission") {
    const callbackId = payload.view?.callback_id;
    if (callbackId === REQUEST_MODAL_CALLBACK_ID) {
      return handleRequestSubmission(payload as ViewSubmissionPayload, timer);
    }
    if (callbackId === APPROVE_DECISION_CALLBACK_ID || callbackId === REJECT_DECISION_CALLBACK_ID) {
      return handleDecisionSubmission(payload as DecisionSubmissionPayload, callbackId === REJECT_DECISION_CALLBACK_ID ? "REJECTED" : "APPROVED", timer);
    }
    if (callbackId === ADD_ADMINISTRATOR_CALLBACK_ID) {
      return handleAddAdministratorSubmission(payload, timer);
    }
    if (callbackId === CONFIGURE_POLICY_CALLBACK_ID) {
      return handlePolicySubmission(payload as PolicySubmissionPayload, timer);
    }
    timer.ack("ignored");
    return ack();
  }

  timer.ack("ignored");
  return ack();
}

/**
 * M8.1: the request row is the only thing that must be durably committed
 * before ack — everything after that (who to notify, and actually sending
 * the notification) is best-effort and does not change whether the
 * submission itself succeeded, so it runs in after(), after the response
 * has already told Slack (and, by extension, the requester) that the
 * request was created. This directly addresses the audit's finding that an
 * awaited Promise.allSettled over every recipient's chat.postMessage could
 * push total latency past Slack's ~3s view_submission window even though
 * the row was already safely committed.
 */
async function handleRequestSubmission(payload: ViewSubmissionPayload, timer: RequestTimer): Promise<Response> {
  // Only view_submission for our modal is handled — anything else (other
  // interaction types, other callback_ids) is acknowledged as a no-op.
  if (payload.type !== "view_submission" || payload.view?.callback_id !== REQUEST_MODAL_CALLBACK_ID) {
    timer.ack("ignored");
    return ack();
  }

  // Re-resolve workspace/user from the trusted, signature-verified payload
  // envelope (payload.team.id / payload.user.id) — never from
  // private_metadata, which is only used here to carry the idempotency key.
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!slackTeamId || !slackUserId) {
    timer.ack("missing_identity");
    return modalErrors({ request_type_block: "Could not identify the Slack workspace or user. Please try again." });
  }

  // Plain existence lookup, not the usable-installation guard: recording
  // the request itself is a pure DB operation that doesn't touch the Slack
  // API or need a token — only the notification tail (below, in after())
  // does, and it re-resolves a fresh usable installation itself.
  const workspace = await timer.time("db", "findWorkspace", () => findWorkspaceBySlackTeamId(slackTeamId));
  if (!workspace) {
    timer.ack("workspace_not_found");
    return modalErrors({ request_type_block: "ApproveFlow isn't installed for this workspace anymore." });
  }

  const requestTypes = await timer.time("db", "listActiveRequestTypes", () => listActiveRequestTypes(workspace.id));
  const result = validateRequestSubmission(payload, { validRequestTypeKeys: requestTypes.map((type) => type.key) });
  if (!result.ok) {
    timer.ack("validation_error");
    return modalErrors(result.errors);
  }

  const requester = await timer.time("db", "upsertRequester", () => upsertSlackUser(workspace.id, result.data.slackUserId));
  const requestType = requestTypes.find((type) => type.key === result.data.requestTypeKey);
  if (!requestType) {
    // Race: the type could have been deactivated between listing it above and here.
    timer.ack("type_race");
    return modalErrors({ request_type_block: "That request type is no longer available. Please try again." });
  }

  // Routing is decided ONCE, here, and frozen on the row — never re-derived
  // later by asking "is there an active policy right now" (see the M4
  // migration adding these columns for why that would be unstable).
  //
  // M9: this is also the ONLY place that determines "current routing
  // truth" for this submission — the Create Request modal hides the
  // Approver field once it believes a policy is active, but that belief
  // can be stale by the time the requester actually submits (an admin may
  // have disabled the policy in between). Never trust what the modal
  // displayed: re-check the active policy fresh, right here.
  //
  // Case A: an active policy exists → POLICY routing. A manually-selected
  // approver, if the (stale) modal happened to still collect one, is
  // resolved for validity but deliberately NOT persisted as though they
  // were responsible for the request — company policy takes precedence.
  //
  // Case B: no active policy → DIRECT routing, requiring a selected
  // approver. If the modal never collected one — because it was built
  // believing a policy was still active — this submission is rejected
  // with a friendly "please reopen" error rather than silently guessing an
  // approver or fabricating routing that was never actually authorized.
  const activePolicy = await timer.time("db", "findActivePolicy", () => findActivePolicyForRequestType(workspace.id, requestType.id));
  const routingDecision = computeRequestRoutingDecision(Boolean(activePolicy), result.data.selectedApproverSlackId);

  if (routingDecision.kind === "rejected_stale_modal") {
    timer.ack("routing_changed");
    return modalErrors({ approver_block: "This request type's approval routing just changed. Please close this window and reopen Create Request." });
  }

  let routingFields:
    | { routing_type: "POLICY"; approval_policy_id: string; direct_approver_id: null; required_approval_count: number }
    | { routing_type: "DIRECT"; approval_policy_id: null; direct_approver_id: string; required_approval_count: 1 };

  if (activePolicy) {
    // routingDecision.kind is guaranteed "policy" here — computeRequestRoutingDecision
    // returns "policy" exactly when hasActivePolicy (Boolean(activePolicy)) was true.
    routingFields = {
      routing_type: "POLICY",
      approval_policy_id: activePolicy.id,
      direct_approver_id: null,
      required_approval_count: activePolicy.required_approvals,
    };
  } else if (routingDecision.kind === "direct") {
    const directApprover = await timer.time("db", "upsertApprover", () => upsertSlackUser(workspace.id, routingDecision.approverSlackId));
    routingFields = { routing_type: "DIRECT", approval_policy_id: null, direct_approver_id: directApprover.id, required_approval_count: 1 };
  }

  const supabase = getSupabaseAdmin();
  const { data: inserted, error } = await timer.time("db", "insertRequest", async () =>
    supabase
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
        requested_amount: result.data.expense.amount,
        requested_currency: result.data.expense.currency,
        status: "PENDING",
        idempotency_key: result.data.idempotencyKey,
        ...routingFields,
      })
      .select("id")
      .single(),
  );

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      // This exact submission was already persisted (e.g. Slack retried the
      // HTTP delivery) — treat as success, and do NOT notify approvers
      // again for a retry.
      timer.ack("duplicate");
      return ack();
    }
    console.error("Failed to persist request:", error.message);
    timer.ack("insert_error");
    return modalErrors({ request_type_block: "Something went wrong saving your request. Please try again." });
  }

  const requestId = inserted.id;
  const requestTypeName = requestType.name;
  const resource = result.data.resource;
  const timing = result.data.timing;
  const expense = result.data.expense;
  const requesterSlackId = result.data.slackUserId;
  // Guaranteed non-null whenever activePolicyId is null (DIRECT) — see the
  // routing determination above, which rejects the submission outright
  // otherwise. Only ever read in the DIRECT branch below.
  const selectedApproverSlackId = result.data.selectedApproverSlackId as string;
  const activePolicyId = activePolicy?.id ?? null;

  // Best-effort notification, deferred until after the response is sent —
  // a Slack delivery failure (or slowness) here can't roll back or delay
  // acknowledging the already-committed request. The background task only
  // closes over immutable, already-resolved values (IDs, plain strings) and
  // independently re-resolves a FRESH usable installation — never a
  // workspace/token captured before the response, since installation state
  // could change in the time between accepting this submission and the
  // task actually running.
  after(() =>
    timer.afterTask("notifyApprovers", async () => {
      try {
        const usableWorkspace = await getUsableInstallation(slackTeamId);
        if (!usableWorkspace) {
          console.log(`Skipping approver notification for request ${requestId}: workspace has no usable Slack installation.`);
          return;
        }
        const recipients: NotificationRecipient[] = activePolicyId
          ? await listPolicyRecipients(activePolicyId)
          : [{ slack_user_id: selectedApproverSlackId, display_name: null }];

        await notifyApprovers({
          workspace: usableWorkspace,
          requestId,
          requestTypeName,
          resource,
          reason: null,
          timing,
          expense,
          requester: { slack_user_id: requesterSlackId, display_name: null },
          recipients,
        });
      } catch (notifyError) {
        console.error("Unexpected error notifying approvers:", notifyError instanceof Error ? notifyError.message : "unknown error");
      }
    }),
  );

  timer.ack("created");
  // Empty body closes the modal normally.
  return ack();
}

/**
 * Minimal shape of the `block_actions` payload fired by the Request Type
 * select's `dispatch_action: true` (see build-request-modal.ts). Selecting
 * a new option in a modal echoes back the *entire current view*, including
 * `id`/`hash` (needed for `views.update`) and `state.values` for every
 * field rendered so far — that live state is the only source used to carry
 * compatible input forward into the rebuilt modal.
 */
interface RequestTypeChangedPayload {
  type?: string;
  team?: { id?: string };
  user?: { id?: string };
  actions?: { action_id?: string; selected_option?: { value?: string } }[];
  view?: {
    id?: string;
    hash?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string | null; selected_option?: { value?: string } | null; selected_user?: string | null; selected_date?: string | null; selected_time?: string | null }>
      >;
    };
  };
}

function readCurrentField(payload: RequestTypeChangedPayload, blockId: string, actionId: string): string | null {
  const field = payload.view?.state?.values?.[blockId]?.[actionId];
  return field?.selected_option?.value ?? field?.selected_user ?? field?.selected_date ?? field?.selected_time ?? field?.value ?? null;
}

/**
 * The dynamic-modal step: selecting a Request Type re-renders the Create
 * Request modal in place with that type's field set (see
 * request-type-config.ts). This is UI state only — it never decides or
 * authorizes anything, and the eventual submission independently
 * re-validates against the FINAL selected type regardless of what this
 * step rendered.
 *
 * M8.1: `views.update` here uses `view_id`/`hash`, never a `trigger_id` —
 * unlike every `views.open`/`views.push` call in this file, this Slack API
 * call has no few-seconds expiry to race against. There is therefore no
 * correctness reason to keep it pre-ack: this handler now does only the
 * minimal, synchronous presence checks before acking, then resolves the
 * workspace, rebuilds the modal, and calls `views.update` entirely inside
 * after(). A `hash_conflict` from rapid repeated type changes is still
 * caught and logged, non-fatal, exactly as before.
 */
async function handleRequestTypeChanged(payload: RequestTypeChangedPayload, timer: RequestTimer): Promise<Response> {
  const slackTeamId = payload.team?.id;
  const viewId = payload.view?.id;
  const viewHash = payload.view?.hash;
  const newTypeKey = payload.actions?.[0]?.selected_option?.value;
  if (!slackTeamId || !viewId || !newTypeKey) {
    timer.ack("ignored");
    return ack();
  }

  let idempotencyKey: string | undefined;
  try {
    const metadata = payload.view?.private_metadata ? JSON.parse(payload.view.private_metadata) : undefined;
    idempotencyKey = typeof metadata?.idempotencyKey === "string" ? metadata.idempotencyKey : undefined;
  } catch {
    idempotencyKey = undefined;
  }
  if (!idempotencyKey) {
    timer.ack("ignored");
    return ack();
  }

  after(() =>
    timer.afterTask("rebuildRequestModal", async () => {
      try {
        const workspace = await getUsableInstallation(slackTeamId);
        if (!workspace) {
          return;
        }

        const requestTypes = await listActiveRequestTypes(workspace.id);
        const newConfig = getRequestTypeFieldConfig(newTypeKey);

        // M9: is the newly-selected type currently governed by an active
        // policy? This is the ONLY place this is computed for rendering —
        // it never gates the initial synchronous modal-open path at all,
        // since every real submission necessarily goes through at least
        // one dispatch_action-triggered rebuild first (Request Type is a
        // required field with no default selection). Zero impact on the
        // trigger_id-bound open flows; this after() callback already has
        // no trigger_id budget to protect.
        const newRequestType = requestTypes.find((type) => type.key === newTypeKey);
        let activePolicySummary: { approverSlackIds: string[]; requiredApprovals: number } | null = null;
        if (newRequestType) {
          const policy = await findActivePolicyForRequestType(workspace.id, newRequestType.id);
          if (policy) {
            const recipients = await listPolicyRecipients(policy.id);
            activePolicySummary = { approverSlackIds: recipients.map((r) => r.slack_user_id), requiredApprovals: policy.required_approvals };
          }
        }

        const currentTiming: RequestTiming = {
          startDate: readCurrentField(payload, START_DATE_BLOCK_ID, START_DATE_ACTION_ID),
          startTime: readCurrentField(payload, START_TIME_BLOCK_ID, START_TIME_ACTION_ID),
          endDate: readCurrentField(payload, END_DATE_BLOCK_ID, END_DATE_ACTION_ID),
          endTime: readCurrentField(payload, END_TIME_BLOCK_ID, END_TIME_ACTION_ID),
        };
        const currentExpense = {
          amount: readCurrentField(payload, EXPENSE_AMOUNT_BLOCK_ID, EXPENSE_AMOUNT_ACTION_ID),
          currency: readCurrentField(payload, EXPENSE_CURRENCY_BLOCK_ID, EXPENSE_CURRENCY_ACTION_ID),
        };

        const preserved: PreservedRequestFields = {
          // Details and Approver are universal — always carried over verbatim.
          resource: readCurrentField(payload, "resource_block", "resource_input"),
          approverSlackId: readCurrentField(payload, "approver_block", "approver_select"),
          timing: remapTimingForModeChange(currentTiming, newConfig.timingMode),
          expense: remapExpenseForModeChange(currentExpense, newConfig.expense),
        };

        const view = buildRequestModal({ requestTypes, idempotencyKey, selectedTypeKey: newTypeKey, preserved, activePolicySummary });

        const botToken = decryptBotToken({
          ciphertext: workspace.bot_access_token_ciphertext,
          iv: workspace.bot_access_token_iv,
          authTag: workspace.bot_access_token_auth_tag,
        });
        const client = new WebClient(botToken);
        await client.views.update({ view_id: viewId, hash: viewHash, view } as Parameters<typeof client.views.update>[0]);
      } catch (error) {
        // Best-effort — includes a possible hash_conflict from rapid repeated
        // type changes racing each other; either way, nothing was corrupted,
        // the requester just doesn't see this particular update reflected.
        console.error("Failed to rebuild Create Request modal for the new type:", error instanceof Error ? error.message : "unknown error");
      }
    }),
  );

  timer.ack("accepted");
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
 *
 * trigger_id-bound (views.open/views.push) — stays fully synchronous,
 * pre-ack, per the M8.1 audit: this is one of the flows that must NOT be
 * deferred to after().
 */
async function handleOpenDecisionModal(payload: BlockActionsPayload, decision: Decision, timer: RequestTimer): Promise<Response> {
  const parsed = parseApprovalBlockAction(payload);
  if (!parsed.ok) {
    // Not one of our recognized actions, or malformed — ignore safely.
    timer.ack("ignored");
    return ack();
  }
  const { slackTeamId, triggerId, requestId, source } = parsed.data;

  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    timer.ack("not_installed");
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
      await timer.time("slack_api", "views.push", () => client.views.push({ trigger_id: triggerId, view } as Parameters<typeof client.views.push>[0]));
    } else {
      await timer.time("slack_api", "views.open", () => client.views.open({ trigger_id: triggerId, view } as Parameters<typeof client.views.open>[0]));
    }
  } catch (error) {
    console.error("Failed to open decision modal:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ack();
  }

  timer.ack("opened");
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
      "resource, reason, requested_duration_minutes, requested_start_date, requested_start_time, requested_end_date, requested_end_time, requested_amount, requested_currency, request_types(name), users!requests_requester_id_fkey(slack_user_id)",
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
    expense: { amount: request.requested_amount, currency: request.requested_currency },
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
 *
 * M8.1 modal-lifecycle analysis (audit-required): submitting this view
 * either (a) fails to apply (DECISION_NOT_APPLIED_OUTCOMES) — reflected
 * SYNCHRONOUSLY via `response_action: "update"`, which replaces THIS
 * modal's own content in place as part of the HTTP response itself, no
 * extra Slack API call involved — or (b) succeeds, in which case an empty
 * `ack()` body is Slack's own signal to close this modal, which requires
 * no work of ours at all. Everything this handler does AFTER a successful
 * decide_on_request() targets a DIFFERENT, independent surface, never the
 * view being closed by this response:
 *   - message-origin: `chat.update` targets the original posted DM
 *     message — entirely unaffected by this modal closing.
 *   - modal-origin: `views.update` targets `source.viewId`, the Request
 *     Details view this decision modal was PUSHED on top of — closing the
 *     top of a view stack reveals what's underneath, it does not close it.
 *     That view is therefore still open and a valid `views.update` target
 *     after this response is sent, not "a view that ceases to exist."
 * Both were already documented as best-effort (a failure here never
 * affects the already-committed decision) even before this milestone, so
 * moving them into after() does not introduce a new risk category — it
 * only moves an already-non-critical, already-independent-surface update
 * slightly later, off Slack's ~3s interactivity budget. The requester
 * notification is the same story, gated exactly as before on
 * isFinalDecisionTransition so a retried/duplicate submission (which
 * decide_on_request reports as "already_decided") can never double-notify.
 */
async function handleDecisionSubmission(payload: DecisionSubmissionPayload, decision: Decision, timer: RequestTimer): Promise<Response> {
  const parsed = validateDecisionSubmission(payload, decision);
  if (!parsed.ok) {
    timer.ack("validation_error");
    return modalErrors(parsed.errors);
  }
  const { slackTeamId, slackUserId, requestId, source, comment } = parsed.data;

  // Plain existence lookup, not the usable-installation guard: recording
  // the decision is a pure DB operation via decide_on_request() and needs
  // no Slack token — only the reflect/notify tail below does, and it
  // re-resolves a fresh usable installation itself, inside after().
  const workspace = await timer.time("db", "findWorkspace", () => findWorkspaceBySlackTeamId(slackTeamId));
  if (!workspace) {
    timer.ack("workspace_not_found");
    return modalUpdate(buildErrorView("ApproveFlow isn't installed for this workspace anymore."));
  }

  let approverId: string;
  let result;
  try {
    const approver = await timer.time("db", "upsertApprover", () => upsertSlackUser(workspace.id, slackUserId));
    approverId = approver.id;
    result = await timer.time("db", "decideOnRequest", () => decideOnRequest({ requestId, approverId, decision, comment }));
  } catch (error) {
    console.error("Failed to record decision:", error instanceof Error ? error.message : "unknown error");
    timer.ack("decide_error");
    return modalUpdate(buildErrorView("Something went wrong recording your decision. Please try again."));
  }

  if (DECISION_NOT_APPLIED_OUTCOMES.has(result.outcome)) {
    // Authorization/conflict outcome — nothing was recorded. Tell the user
    // why instead of silently closing the modal as if it had worked. This
    // is a synchronous response_action:update — no additional Slack API
    // call, so there's nothing to defer here.
    timer.ack(result.outcome);
    return modalUpdate(buildErrorView(describeDecisionOutcome(result)));
  }

  // Best-effort, deferred to after() — see the handler's own doc comment
  // above for why this is safe for both decision origins. Closes only over
  // immutable, already-resolved values and independently re-resolves a
  // FRESH usable installation, never a workspace/token captured before the
  // response.
  const decidedResult = result;
  after(() =>
    timer.afterTask("reflectAndNotify", async () => {
      const usableWorkspace = await getUsableInstallation(slackTeamId);
      if (!usableWorkspace) {
        console.log(`Skipping decision reflection/notification for request ${requestId}: workspace has no usable Slack installation.`);
        return;
      }

      try {
        const botToken = decryptBotToken({
          ciphertext: usableWorkspace.bot_access_token_ciphertext,
          iv: usableWorkspace.bot_access_token_iv,
          authTag: usableWorkspace.bot_access_token_auth_tag,
        });
        const client = new WebClient(botToken);
        const statusText = describeDecisionOutcome(decidedResult);

        if (source.type === "message") {
          const rebuilt = await rebuildApprovalMessageContent(usableWorkspace.id, requestId);
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
          const details = await getRequestDetails(usableWorkspace.id, requestId, approverId);
          const view = details ? buildRequestDetailsView({ details, banner: statusText }) : buildErrorView("This request could not be found.");
          await client.views.update({ view_id: source.viewId, view } as Parameters<typeof client.views.update>[0]);
        }
      } catch (error) {
        console.error("Failed to reflect decision outcome in Slack:", error instanceof Error ? error.message : "unknown error");
      }

      // Notify the original requester, but ONLY when THIS interaction
      // actually caused a final transition — never for retries/duplicates/
      // already-final requests/unauthorized attempts/intermediate policy
      // approvals. Gating on the RPC's own outcome means a Slack HTTP retry
      // of the same submission (reported as "already_decided") can never
      // trigger a second notification.
      if (isFinalDecisionTransition(decidedResult.outcome)) {
        try {
          await notifyRequesterOfDecision({
            workspace: usableWorkspace,
            requestId,
            decision: decidedResult.outcome === "approved" ? "APPROVED" : "REJECTED",
            decidingApproverSlackId: slackUserId,
          });
        } catch (error) {
          console.error("Failed to notify requester of decision:", error instanceof Error ? error.message : "unknown error");
        }
      }
    }),
  );

  timer.ack(decidedResult.outcome);
  // Empty body closes the decision modal — if it was pushed onto Request
  // Details, this pops back to that (now-updated, once after() runs) view
  // underneath, same as clicking Cancel would.
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
 *
 * trigger_id-bound throughout — stays fully synchronous, pre-ack. M8.1
 * only reduces the DB round trips ahead of the Slack call: Create Request's
 * `upsertSlackUser` (whose result isn't used in that branch) runs
 * concurrently with the ensure→list chain, and `getRequestDetails`'s own
 * internal round trips were reduced separately (see request-views.ts).
 */
async function handleRequestsNavigation(payload: RequestsNavigationPayload, timer: RequestTimer): Promise<Response> {
  const parsed = parseRequestsNavigationAction(payload);
  if (!parsed.ok) {
    timer.ack("ignored");
    return ack();
  }
  const { slackTeamId, slackUserId, triggerId, origin } = parsed.data;

  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    timer.ack("not_installed");
    return ack();
  }

  try {
    let view: ModalView;

    if (parsed.data.actionId === CREATE_REQUEST_ACTION_ID) {
      // Mirrors /request's own bootstrap exactly, since Home must work for
      // a user who has never run any command before. `upsertSlackUser`'s
      // result isn't needed by this branch, so it runs concurrently with
      // the ensure→list chain rather than ahead of it.
      const [, requestTypes] = await timer.time("db", "upsertUser+ensureAndListTypes", () =>
        Promise.all([
          upsertSlackUser(workspace.id, slackUserId),
          (async () => {
            await ensureDefaultRequestTypes(workspace.id);
            return listActiveRequestTypes(workspace.id);
          })(),
        ]),
      );
      view = buildRequestModal({ requestTypes, idempotencyKey: randomUUID() });
    } else {
      const viewer = await timer.time("db", "upsertViewer", () => upsertSlackUser(workspace.id, slackUserId));

      if (parsed.data.actionId === VIEW_WAITING_REQUESTS_ACTION_ID) {
        const waitingRequests = await timer.time("db", "listRequestsWaitingForApprover", () => listRequestsWaitingForApprover(workspace.id, viewer.id));
        view = buildWaitingListView({ waitingRequests });
      } else if (parsed.data.actionId === VIEW_REQUEST_ACTION_ID) {
        // Revalidates workspace ownership again inside getRequestDetails —
        // the request id from the button value is an opaque locator only.
        // (Extracted to a plain const: TS discriminated-union narrowing
        // doesn't extend into a closure re-accessing `parsed.data` itself.)
        const requestId = parsed.data.requestId;
        const details = await timer.time("db", "getRequestDetails", () => getRequestDetails(workspace.id, requestId, viewer.id));
        view = details ? buildRequestDetailsView({ details }) : buildErrorView("This request could not be found.");
      } else {
        // OPEN_REQUEST_CENTER_ACTION_ID
        const [{ rows: myRequests, totalCount }, waitingRequests] = await timer.time("db", "listRequestsForCenter", () =>
          Promise.all([listRequestsByRequester(workspace.id, viewer.id), listRequestsWaitingForApprover(workspace.id, viewer.id)]),
        );
        view = buildRequestCenterView({ myRequests, myRequestsTotalCount: totalCount, waitingCount: waitingRequests.length });
      }
    }

    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
    const client = new WebClient(botToken);
    if (origin === "home") {
      await timer.time("slack_api", "views.open", () => client.views.open({ trigger_id: triggerId, view } as Parameters<typeof client.views.open>[0]));
    } else {
      await timer.time("slack_api", "views.push", () => client.views.push({ trigger_id: triggerId, view } as Parameters<typeof client.views.push>[0]));
    }
  } catch (error) {
    console.error("Failed to open/push /requests navigation view:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ack();
  }

  timer.ack("opened");
  return ack();
}
