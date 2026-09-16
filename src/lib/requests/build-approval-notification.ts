import { formatWhenLabel, type RequestTiming } from "./request-timing.ts";
import type { DecideOnRequestResult } from "../../types/approval.ts";

export const APPROVE_ACTION_ID = "approve_request";
export const REJECT_ACTION_ID = "reject_request";
export const APPROVAL_ACTIONS_BLOCK_ID = "approval_actions";
export const APPROVAL_STATUS_BLOCK_ID = "approval_status";

/**
 * `chat.postMessage`/`chat.update`'s argument types are unions keyed on
 * which of text/blocks/attachments/markdown_text is provided (see
 * @slack/web-api's ChannelAndBlocks/ChannelAndText/... in
 * types/request/chat.d.ts), which doesn't compose well with an object built
 * up from a shared `text` + `blocks` shape. Unlike build-request-modal.ts's
 * single `View` type, there's no single member type worth extracting here,
 * so this is hand-written against Block Kit's documented JSON shape instead
 * — callers cast to the SDK's parameter type at the call site.
 */
export interface ApprovalMessageContent {
  text: string;
  blocks: unknown[];
}

export function formatUserMention(user: { display_name: string | null; slack_user_id: string }): string {
  return user.display_name ?? `<@${user.slack_user_id}>`;
}

export interface BuildApprovalNotificationParams {
  requestId: string;
  requestTypeName: string;
  requester: { display_name: string | null; slack_user_id: string };
  /** Customer-facing "Details". */
  resource: string;
  /** M8: null for every new request (merged into Details) — non-null only for pre-M8 historical requests, which still show it. */
  reason: string | null;
  /** M8 correction: replaces the fixed duration dropdown for new requests — see request-timing.ts. */
  timing: RequestTiming;
  /** Non-null only for pre-M8-correction historical requests — see request-timing.ts's formatWhenLabel. */
  legacyDurationMinutes: number | null;
}

/** The initial DM sent to each policy member when a request is created. Includes the Approve/Reject buttons. */
export function buildApprovalNotification({
  requestId,
  requestTypeName,
  requester,
  resource,
  reason,
  timing,
  legacyDurationMinutes,
}: BuildApprovalNotificationParams): ApprovalMessageContent {
  const requesterMention = formatUserMention(requester);
  const buttonValue = JSON.stringify({ requestId });

  const fields: { type: "mrkdwn"; text: string }[] = [
    { type: "mrkdwn", text: `*Requester:*\n${requesterMention}` },
    { type: "mrkdwn", text: `*Details:*\n${resource}` },
  ];
  if (reason) {
    fields.push({ type: "mrkdwn", text: `*Reason:*\n${reason}` });
  }
  const when = formatWhenLabel(timing, legacyDurationMinutes);
  if (when) {
    fields.push({ type: "mrkdwn", text: `*${when.label}:*\n${when.value}` });
  }

  return {
    text: `New ${requestTypeName} request from ${requesterMention}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*New ${requestTypeName} request*` },
      },
      {
        type: "section",
        fields,
      },
      {
        type: "context",
        block_id: APPROVAL_STATUS_BLOCK_ID,
        elements: [{ type: "mrkdwn", text: "Status: *PENDING*" }],
      },
      {
        type: "actions",
        block_id: APPROVAL_ACTIONS_BLOCK_ID,
        elements: [
          {
            type: "button",
            action_id: APPROVE_ACTION_ID,
            style: "primary",
            text: { type: "plain_text", text: "Approve" },
            value: buttonValue,
          },
          {
            type: "button",
            action_id: REJECT_ACTION_ID,
            style: "danger",
            text: { type: "plain_text", text: "Reject" },
            value: buttonValue,
          },
        ],
      },
    ],
  };
}

/**
 * After a decision, drop the Approve/Reject buttons entirely (so they can't
 * be clicked again) and replace the status line — reusing the original
 * message's own blocks (as Slack echoes them back in the block_actions
 * payload) so the request details aren't re-fetched or reconstructed.
 */
export function replaceActionsWithStatus(blocks: unknown[], statusText: string): unknown[] {
  const kept = blocks.filter((block) => {
    const { type, block_id } = block as { type?: string; block_id?: string };
    return type !== "actions" && block_id !== APPROVAL_ACTIONS_BLOCK_ID && block_id !== APPROVAL_STATUS_BLOCK_ID;
  });

  return [
    ...kept,
    {
      type: "context",
      block_id: APPROVAL_STATUS_BLOCK_ID,
      elements: [{ type: "mrkdwn", text: statusText }],
    },
  ];
}

/** Maps a decide_on_request() outcome to the status text shown to the clicking approver. Never exposes internal IDs/details. */
export function describeDecisionOutcome(result: DecideOnRequestResult): string {
  switch (result.outcome) {
    case "rejected":
      return "❌ You rejected this request.";
    case "approved":
      return "✅ Request approved.";
    case "recorded_pending": {
      const remaining = (result.required_approvals ?? 0) - (result.approvals_count ?? 0);
      const plural = remaining === 1 ? "approval" : "approvals";
      return `🟡 Your approval was recorded. Waiting for ${remaining} more ${plural}.`;
    }
    case "already_final":
      return `This request has already been ${result.request_status ?? "decided"}.`;
    case "already_decided":
      return "You've already recorded a decision on this request.";
    case "unauthorized":
      return "You're not authorized to decide on this request.";
    case "no_policy":
      return "This request has no approval policy configured.";
    case "not_found":
    default:
      return "This request could not be found.";
  }
}
