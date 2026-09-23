import type { RequestStatusForDecision } from "./compute-decision-outcome.ts";

/**
 * POST-M11-A: whether clicking Approve/Reject should open the decision
 * modal at all. Extracted as its own pure function specifically so the
 * branch that caused the stale-message bug — TERMINAL requests must never
 * open the modal — is testable without mocking Slack API calls, tokens, or
 * the DB. Never a substitute for decide_on_request()'s own authoritative
 * status check: that RPC re-verifies status itself and remains the sole
 * source of truth if this pre-check ever races with another decision.
 */
export type DecisionOpenBehavior =
  | { shouldOpenModal: true }
  | { shouldOpenModal: false; requestStatus: RequestStatusForDecision };

export function computeDecisionOpenBehavior(requestStatus: RequestStatusForDecision): DecisionOpenBehavior {
  if (requestStatus === "PENDING") {
    return { shouldOpenModal: true };
  }
  return { shouldOpenModal: false, requestStatus };
}
