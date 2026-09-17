/**
 * M9: pure mirror of the routing decision handleRequestSubmission makes at
 * final submission — same "pure mirror of a security-critical branch"
 * pattern as compute-decision-outcome.ts. `hasActivePolicy` must already
 * reflect FRESH, server-side policy state (re-checked at submission time,
 * never trusted from what the modal displayed) — this function only
 * encodes what to do given that fact, not how to obtain it.
 *
 * "policy" always wins regardless of `selectedApproverSlackId` — a manual
 * approver, even a validly-formatted one, is never enough to override an
 * active policy. "rejected_stale_modal" is the one case that must never
 * silently invent or guess a routing decision: no active policy AND no
 * collected approver means the modal was built believing a policy was
 * still active, and that belief is now stale.
 */

export type RequestRoutingDecision = { kind: "policy" } | { kind: "direct"; approverSlackId: string } | { kind: "rejected_stale_modal" };

export function computeRequestRoutingDecision(hasActivePolicy: boolean, selectedApproverSlackId: string | null): RequestRoutingDecision {
  if (hasActivePolicy) {
    return { kind: "policy" };
  }
  if (selectedApproverSlackId) {
    return { kind: "direct", approverSlackId: selectedApproverSlackId };
  }
  return { kind: "rejected_stale_modal" };
}
