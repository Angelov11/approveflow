import type { WebClient } from "@slack/web-api";

import { formatSlackDate } from "../slack/format-date.ts";
import type { RequestStatus } from "../../types/request.ts";
import { APPROVE_ACTION_ID, REJECT_ACTION_ID } from "./build-approval-notification.ts";
import { VIEW_REQUEST_ACTION_ID, VIEW_WAITING_REQUESTS_ACTION_ID } from "./parse-requests-action.ts";
import type { WhenLabel } from "./request-timing.ts";
import { formatStatusLabel } from "./status-display.ts";

export const REQUEST_CENTER_CALLBACK_ID = "approveflow_request_center";
export const WAITING_LIST_CALLBACK_ID = "approveflow_waiting_list";
export const REQUEST_DETAILS_CALLBACK_ID = "approveflow_request_details";

/** Derived from the installed @slack/web-api version's own `views.open` argument type — see build-request-modal.ts for why. */
export type ModalView = Parameters<WebClient["views"]["open"]>[0]["view"];

/** A minimal, safe fallback view — used whenever a lookup fails (not found, wrong workspace, etc.) so we never expose a database error or stack trace. */
export function buildErrorView(message: string): ModalView {
  return {
    type: "modal",
    callback_id: REQUEST_DETAILS_CALLBACK_ID,
    title: { type: "plain_text", text: "ApproveFlow" },
    close: { type: "plain_text", text: "Close" },
    blocks: [{ type: "section", text: { type: "mrkdwn", text: message } }],
  } as ModalView;
}

export interface RequestSummary {
  id: string;
  requestTypeName: string;
  resource: string;
  status: RequestStatus;
  /** Precomputed by request-views.ts via request-timing.ts's formatWhenLabel — null when there's genuinely nothing to show (never rendered as a placeholder). Mutually exclusive with `amountText` by construction (a request is either timed or expense-bearing, never both). */
  whenText: string | null;
  /** Precomputed by request-views.ts via expense.ts's formatAmountLabel — null for every non-expense request. */
  amountText: string | null;
  createdAt: string;
}

export interface RequestDecisionRecord {
  slackUserId: string;
  decision: "APPROVED" | "REJECTED";
  /** M7: optional for APPROVED, always non-null for REJECTED — except pre-M7 historical REJECTED rows, which have none and render with no comment line at all (never a fabricated "No reason provided" placeholder). */
  comment: string | null;
}

/**
 * Never exposes internal UUIDs, routing_type values, or DB terminology —
 * the UI speaks in "policy"/"approver" language. POLICY_UNAVAILABLE models
 * the M4 historical edge case (approval_policy_id null): routing info
 * simply couldn't be identified during backfill, not fabricated.
 */
export type RequestRoutingView =
  | { type: "DIRECT"; approverSlackUserId: string }
  | { type: "POLICY"; policyName: string; requiredApprovals: number; pendingMemberSlackUserIds: string[] }
  | { type: "POLICY_UNAVAILABLE" };

export interface RequestDetailsView {
  id: string;
  requestTypeName: string;
  /** Customer-facing "Details". */
  resource: string;
  /** M8: null for every new request (merged into Details) — non-null only for pre-M8 historical requests, which still show it as "Reason". */
  reason: string | null;
  /** Precomputed by request-views.ts via request-timing.ts's formatWhenLabel — null when there's genuinely nothing to show (field omitted entirely, never a placeholder). Mutually exclusive with `amountLabel` by construction. */
  when: WhenLabel | null;
  /** Precomputed by request-views.ts via expense.ts's formatAmountLabel — null for every non-expense request. */
  amountLabel: string | null;
  status: RequestStatus;
  createdAt: string;
  requesterSlackUserId: string;
  routing: RequestRoutingView;
  /** Historical decisions — always shown even for someone since removed from the policy (see M4 live-membership design). */
  decisions: RequestDecisionRecord[];
  canCurrentUserDecide: boolean;
}

/** Exported for reuse by the App Home builder (M6) — Home's "My Requests" rows are the exact same shape as the Request Center's. */
export function buildRequestRowBlocks(requests: RequestSummary[]): unknown[] {
  return requests.map((r) => {
    const summaryText = r.whenText ?? r.amountText;
    const timingLine = summaryText ? `${summaryText} · ` : "";
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${formatStatusLabel(r.status)}\n*${r.requestTypeName}* — ${r.resource}\n${timingLine}Requested ${formatSlackDate(r.createdAt)}`,
      },
      accessory: {
        type: "button",
        action_id: VIEW_REQUEST_ACTION_ID,
        text: { type: "plain_text", text: "View" },
        value: JSON.stringify({ requestId: r.id }),
      },
    };
  });
}

export interface BuildRequestCenterViewParams {
  myRequests: RequestSummary[];
  myRequestsTotalCount: number;
  waitingCount: number;
}

/**
 * A single modal with both sections stacked, rather than a tab-switching
 * framework Slack modals don't naturally support (see the M5 report for
 * the full UX rationale). "My Requests" is shown inline since it's purely
 * informational; "Waiting for Me" is a summary + button that pushes a
 * dedicated list, since those entries need Approve/Reject affordances that
 * would clutter this view.
 */
export function buildRequestCenterView({ myRequests, myRequestsTotalCount, waitingCount }: BuildRequestCenterViewParams): ModalView {
  const blocks: unknown[] = [{ type: "header", text: { type: "plain_text", text: "My Requests" } }];

  if (myRequests.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "You haven't submitted any requests yet." } });
  } else {
    blocks.push(...buildRequestRowBlocks(myRequests));
    if (myRequestsTotalCount > myRequests.length) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `Showing your ${myRequests.length} most recent requests.` }],
      });
    }
  }

  blocks.push({ type: "divider" }, { type: "header", text: { type: "plain_text", text: "Waiting for Me" } });

  if (waitingCount === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "Nothing is waiting for your approval." } });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${waitingCount}* request${waitingCount === 1 ? "" : "s"} need${waitingCount === 1 ? "s" : ""} your decision.`,
      },
      accessory: {
        type: "button",
        action_id: VIEW_WAITING_REQUESTS_ACTION_ID,
        text: { type: "plain_text", text: "View waiting requests" },
      },
    });
  }

  return {
    type: "modal",
    callback_id: REQUEST_CENTER_CALLBACK_ID,
    title: { type: "plain_text", text: "ApproveFlow" },
    close: { type: "plain_text", text: "Close" },
    blocks,
  } as ModalView;
}

export function buildWaitingListView({ waitingRequests }: { waitingRequests: RequestSummary[] }): ModalView {
  const blocks: unknown[] =
    waitingRequests.length === 0
      ? [{ type: "section", text: { type: "mrkdwn", text: "Nothing is waiting for your approval." } }]
      : buildRequestRowBlocks(waitingRequests);

  return {
    type: "modal",
    callback_id: WAITING_LIST_CALLBACK_ID,
    title: { type: "plain_text", text: "Waiting for Me" },
    close: { type: "plain_text", text: "Close" },
    blocks,
  } as ModalView;
}

/** Never shows an empty "No comment provided" placeholder — a comment line only appears when one actually exists (always true for post-M7 rejections; optional everywhere else, including all pre-M7 historical decisions). */
function decisionLine(record: RequestDecisionRecord): string {
  const icon = record.decision === "APPROVED" ? "✅" : "❌";
  const verb = record.decision === "APPROVED" ? "approved" : "rejected";
  const line = `${icon} <@${record.slackUserId}> ${verb}`;
  if (!record.comment) {
    return line;
  }
  return record.decision === "REJECTED" ? `${line}\nReason: "${record.comment}"` : `${line}\n"${record.comment}"`;
}

export interface BuildRequestDetailsViewParams {
  details: RequestDetailsView;
  /** Shown as a callout at the top — used to safely reflect a just-attempted decision's outcome (including a stale/unauthorized attempt) without assuming what the click accomplished. */
  banner?: string;
}

export function buildRequestDetailsView({ details, banner }: BuildRequestDetailsViewParams): ModalView {
  const blocks: unknown[] = [];

  if (banner) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${banner}*` } }, { type: "divider" });
  }

  // M8: "Reason" only appears for pre-M8 historical requests that actually
  // have one — new requests merge it into "Details" and never populate it,
  // so there's nothing to (mis)render for them.
  const detailFields: { type: "mrkdwn"; text: string }[] = [
    { type: "mrkdwn", text: `*Request type:*\n${details.requestTypeName}` },
    { type: "mrkdwn", text: `*Details:*\n${details.resource}` },
  ];
  if (details.reason) {
    detailFields.push({ type: "mrkdwn", text: `*Reason:*\n${details.reason}` });
  }
  if (details.when) {
    detailFields.push({ type: "mrkdwn", text: `*${details.when.label}:*\n${details.when.value}` });
  }
  if (details.amountLabel) {
    detailFields.push({ type: "mrkdwn", text: `*Amount:*\n${details.amountLabel}` });
  }
  detailFields.push(
    { type: "mrkdwn", text: `*Requester:*\n<@${details.requesterSlackUserId}>` },
    { type: "mrkdwn", text: `*Status:*\n${formatStatusLabel(details.status)}` },
  );

  blocks.push(
    { type: "section", fields: detailFields },
    { type: "context", elements: [{ type: "mrkdwn", text: `Requested ${formatSlackDate(details.createdAt)}` }] },
    { type: "divider" },
  );

  if (details.routing.type === "DIRECT") {
    const decision = details.decisions[0];
    const line = decision ? decisionLine(decision) : `🟡 <@${details.routing.approverSlackUserId}> pending`;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Approver*\n${line}` } });
  } else if (details.routing.type === "POLICY") {
    const approvedCount = details.decisions.filter((d) => d.decision === "APPROVED").length;
    const lines = [
      ...details.decisions.map(decisionLine),
      ...details.routing.pendingMemberSlackUserIds.map((id) => `🟡 <@${id}> pending`),
    ];
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Approval policy:*\n${details.routing.policyName}\n\n*Approvals* (${approvedCount} of ${details.routing.requiredApprovals})\n${lines.length > 0 ? lines.join("\n") : "No decisions yet."}`,
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Approval routing unavailable for this historical request._" },
    });
  }

  if (details.canCurrentUserDecide) {
    blocks.push({ type: "divider" }, {
      type: "actions",
      block_id: "request_details_actions",
      elements: [
        {
          type: "button",
          action_id: APPROVE_ACTION_ID,
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          value: JSON.stringify({ requestId: details.id }),
        },
        {
          type: "button",
          action_id: REJECT_ACTION_ID,
          style: "danger",
          text: { type: "plain_text", text: "Reject" },
          value: JSON.stringify({ requestId: details.id }),
        },
      ],
    });
  }

  return {
    type: "modal",
    callback_id: REQUEST_DETAILS_CALLBACK_ID,
    title: { type: "plain_text", text: "Request Details" },
    close: { type: "plain_text", text: "Close" },
    blocks,
  } as ModalView;
}
