import type { WebClient } from "@slack/web-api";

/** Derived from the installed @slack/web-api version's own `views.open` argument type — see build-request-modal.ts for why. */
export type ModalView = Parameters<WebClient["views"]["open"]>[0]["view"];

export const APPROVE_DECISION_CALLBACK_ID = "approveflow_approve_decision";
export const REJECT_DECISION_CALLBACK_ID = "approveflow_reject_decision";

export const DECISION_COMMENT_BLOCK_ID = "decision_comment_block";
export const DECISION_COMMENT_ACTION_ID = "decision_comment_input";

/**
 * Practical Slack-modal-compatible ceiling for a decision comment/reason —
 * enforced consistently in this modal's own `max_length`, in
 * validate-decision-submission.ts (UX), and in the decide_on_request RPC
 * (authoritative). No layer silently truncates; all three reject an
 * oversized value outright.
 */
export const MAX_DECISION_COMMENT_LENGTH = 1000;

/**
 * The minimum locator/context needed to continue this interaction after the
 * decision modal is submitted — treated as untrusted by the caller.
 * `requestId` is an opaque locator only (decide_on_request re-authorizes
 * independently); `source` only says where to reflect the outcome
 * afterward (chat.update on a message, or views.update on a modal),
 * carrying just enough to do that — never the original message/view
 * `blocks`, which would risk overflowing Slack's 3000-character
 * `private_metadata` limit for a request with a long resource/reason (the
 * message-origin reflect step rebuilds its content fresh from the database
 * instead — see interactions/route.ts).
 */
export type DecisionModalSource = { type: "message"; channelId: string; messageTs: string } | { type: "modal"; viewId: string };

export interface DecisionModalMetadata {
  requestId: string;
  source: DecisionModalSource;
}

export interface BuildDecisionModalParams {
  decision: "APPROVED" | "REJECTED";
  requestId: string;
  source: DecisionModalSource;
}

/**
 * Opened in place of immediately committing a decision (M7) — Approve
 * clicks open this with an optional Comment field, Reject clicks open it
 * with a required Reason field. Submitting it re-authorizes and records the
 * decision atomically via the existing decide_on_request() RPC; opening
 * this modal itself grants no authorization at all (see the interactions
 * route's view_submission handler).
 */
export function buildDecisionModal({ decision, requestId, source }: BuildDecisionModalParams): ModalView {
  const isReject = decision === "REJECTED";
  const metadata: DecisionModalMetadata = { requestId, source };

  return {
    type: "modal",
    callback_id: isReject ? REJECT_DECISION_CALLBACK_ID : APPROVE_DECISION_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: isReject ? "Reject Request" : "Approve Request" },
    submit: { type: "plain_text", text: isReject ? "Reject" : "Approve" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: DECISION_COMMENT_BLOCK_ID,
        optional: !isReject,
        label: { type: "plain_text", text: isReject ? "Reason" : "Comment" },
        element: {
          type: "plain_text_input",
          action_id: DECISION_COMMENT_ACTION_ID,
          multiline: true,
          max_length: MAX_DECISION_COMMENT_LENGTH,
          placeholder: isReject
            ? { type: "plain_text", text: "e.g. Budget exceeded." }
            : { type: "plain_text", text: "Optional — e.g. Looks good, approved." },
        },
      },
    ],
  } as ModalView;
}
