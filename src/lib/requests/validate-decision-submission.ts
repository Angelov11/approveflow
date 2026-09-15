import { DECISION_COMMENT_BLOCK_ID, DECISION_COMMENT_ACTION_ID, MAX_DECISION_COMMENT_LENGTH, type DecisionModalSource } from "./build-decision-modal.ts";

/**
 * Minimal shape of a Slack `view_submission` payload for the M7 decision
 * modal — deliberately the same shape as ViewSubmissionPayload in
 * validate-request-submission.ts (this app never types inbound interaction
 * payloads via an SDK; both are hand-written against Slack's documented
 * shape), kept as a separate type only so this file has no dependency on
 * the unrelated request-submission module.
 */
export interface DecisionSubmissionPayload {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, { value?: string | null }>>;
    };
  };
}

export interface ValidatedDecisionSubmission {
  slackTeamId: string;
  slackUserId: string;
  requestId: string;
  source: DecisionModalSource;
  /** Trimmed; empty/whitespace-only normalizes to null. Never null when `decision` is REJECTED — validated below. */
  comment: string | null;
}

export type ValidateDecisionSubmissionResult =
  | { ok: true; data: ValidatedDecisionSubmission }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates a decision modal's view_submission structurally and against the
 * comment/reason business rules — never touches the database, never
 * authorizes anything. `decision` is supplied by the CALLER, derived from
 * which callback_id Slack routed the submission to (APPROVE_DECISION_CALLBACK_ID
 * vs REJECT_DECISION_CALLBACK_ID) — a trusted property of the view itself,
 * not a value read out of this payload's private_metadata, so there's
 * nothing here for a tampered private_metadata to override.
 *
 * `private_metadata`'s `requestId`/`source` are read only as opaque locators
 * for what to decide on and where to reflect the outcome afterward — never
 * as authorization, never as a source of workspace/user identity. Identity
 * always comes from `payload.team`/`payload.user`, the signature-verified
 * envelope fields, exactly like every other interaction in this app.
 */
export function validateDecisionSubmission(
  payload: DecisionSubmissionPayload,
  decision: "APPROVED" | "REJECTED",
): ValidateDecisionSubmissionResult {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!slackTeamId || !slackUserId) {
    return { ok: false, errors: { [DECISION_COMMENT_BLOCK_ID]: "Could not identify the Slack workspace or user. Please try again." } };
  }

  let requestId: string | undefined;
  let source: DecisionModalSource | undefined;
  try {
    const metadata = payload.view?.private_metadata ? JSON.parse(payload.view.private_metadata) : undefined;
    requestId = typeof metadata?.requestId === "string" ? metadata.requestId : undefined;
    source = metadata?.source && typeof metadata.source?.type === "string" ? metadata.source : undefined;
  } catch {
    requestId = undefined;
    source = undefined;
  }
  if (!requestId || !source) {
    return { ok: false, errors: { [DECISION_COMMENT_BLOCK_ID]: "This decision could not be verified. Please try again." } };
  }

  const rawComment = payload.view?.state?.values?.[DECISION_COMMENT_BLOCK_ID]?.[DECISION_COMMENT_ACTION_ID]?.value ?? "";
  const trimmed = rawComment.trim();
  const isReject = decision === "REJECTED";

  if (isReject && trimmed.length === 0) {
    return { ok: false, errors: { [DECISION_COMMENT_BLOCK_ID]: "Please provide a reason for rejecting this request." } };
  }
  if (trimmed.length > MAX_DECISION_COMMENT_LENGTH) {
    const label = isReject ? "reason" : "comment";
    return { ok: false, errors: { [DECISION_COMMENT_BLOCK_ID]: `Please keep your ${label} to ${MAX_DECISION_COMMENT_LENGTH} characters or fewer.` } };
  }

  return {
    ok: true,
    data: {
      slackTeamId,
      slackUserId,
      requestId,
      source,
      comment: trimmed.length > 0 ? trimmed : null,
    },
  };
}
