export type DecisionOutcome =
  | "not_found"
  | "already_final"
  | "no_policy"
  | "unauthorized"
  | "already_decided"
  | "rejected"
  | "approved"
  | "recorded_pending";

/**
 * True only when THIS decide_on_request() call is what just caused the
 * request to reach a final state — never for retries, duplicates,
 * already-final requests, unauthorized attempts, or an intermediate
 * (below-threshold) policy approval. This is the sole gate for sending a
 * requester notification: a Slack HTTP retry of the same click causes
 * decide_on_request() to return "already_decided" rather than "approved"/
 * "rejected" again, so gating on this function's result alone prevents a
 * duplicate requester notification without needing any persisted
 * "notification already sent" state.
 */
export function isFinalDecisionTransition(outcome: DecisionOutcome): boolean {
  return outcome === "approved" || outcome === "rejected";
}

export interface RequesterDecisionMessageContent {
  text: string;
  blocks: unknown[];
}

export interface BuildRequesterDecisionNotificationParams {
  decision: "APPROVED" | "REJECTED";
  requestTypeName: string;
  resource: string;
  durationLabel: string;
  routingType: "POLICY" | "DIRECT";
  /** The Slack user whose click caused this transition. */
  decidingApproverSlackId: string;
}

/** DM sent to the original requester once their request reaches a final decision. Never sent for intermediate policy approvals. */
export function buildRequesterDecisionNotification({
  decision,
  requestTypeName,
  resource,
  durationLabel,
  routingType,
  decidingApproverSlackId,
}: BuildRequesterDecisionNotificationParams): RequesterDecisionMessageContent {
  const approved = decision === "APPROVED";
  const headline = approved ? "✅ Your request was approved" : "❌ Your request was rejected";

  // An APPROVED POLICY request isn't attributed to a single person: showing
  // "Approved by <the last clicker>" would misleadingly imply they were the
  // sole approver when more than one approval may have been required.
  // DIRECT approvals have exactly one possible approver, and a rejection
  // always finalizes immediately regardless of routing — both cases
  // accurately attribute a single deciding person.
  const showDecidingApprover = !approved || routingType === "DIRECT";

  const fields: { type: "mrkdwn"; text: string }[] = [
    { type: "mrkdwn", text: `*Request type:*\n${requestTypeName}` },
    { type: "mrkdwn", text: `*Resource:*\n${resource}` },
    { type: "mrkdwn", text: `*Duration:*\n${durationLabel}` },
    { type: "mrkdwn", text: `*Status:*\n${decision}` },
  ];
  if (showDecidingApprover) {
    fields.push({
      type: "mrkdwn",
      text: `*${approved ? "Approved" : "Rejected"} by:*\n<@${decidingApproverSlackId}>`,
    });
  }

  return {
    text: headline,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${headline}*` } },
      { type: "section", fields },
    ],
  };
}
