/**
 * Pure mirror of supabase/migrations/*_create_decide_on_request_function.sql
 * — same rules, same outcome names. Keep the two in sync if either changes.
 *
 * This is what's actually unit tested (see compute-decision-outcome.test.ts),
 * because SQL can't run under Node's test runner. It is NOT what runs in
 * production: the real authorization + atomicity guarantee comes from the
 * SQL function executed via a single locked transaction (see its header
 * comment for the race condition that requires real DB-level locking, which
 * this pure, non-transactional function cannot provide). This function
 * exists purely as an exhaustively-tested specification of the algorithm.
 */

import type { Decision } from "../../types/approval.ts";

export type RequestStatusForDecision = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";

export interface ExistingApproval {
  approverId: string;
  decision: Decision;
}

export interface DecisionInputs {
  requestExists: boolean;
  requestStatus: RequestStatusForDecision;
  /** null means no active policy exists for this request's type. */
  policy: { memberIds: string[]; requiredApprovals: number } | null;
  existingApprovals: ExistingApproval[];
  approverId: string;
  decision: Decision;
}

export type DecisionOutcome =
  | { outcome: "not_found" }
  | { outcome: "already_final"; requestStatus: RequestStatusForDecision }
  | { outcome: "no_policy"; requestStatus: RequestStatusForDecision }
  | { outcome: "unauthorized"; requestStatus: RequestStatusForDecision }
  | { outcome: "already_decided"; requestStatus: RequestStatusForDecision }
  | { outcome: "rejected" }
  | { outcome: "approved"; approvalsCount: number; requiredApprovals: number }
  | { outcome: "recorded_pending"; approvalsCount: number; requiredApprovals: number };

export function computeDecisionOutcome(inputs: DecisionInputs): DecisionOutcome {
  const { requestExists, requestStatus, policy, existingApprovals, approverId, decision } = inputs;

  if (!requestExists) {
    return { outcome: "not_found" };
  }
  if (requestStatus !== "PENDING") {
    return { outcome: "already_final", requestStatus };
  }
  if (!policy) {
    return { outcome: "no_policy", requestStatus };
  }
  if (!policy.memberIds.includes(approverId)) {
    return { outcome: "unauthorized", requestStatus };
  }
  if (existingApprovals.some((a) => a.approverId === approverId)) {
    return { outcome: "already_decided", requestStatus };
  }

  if (decision === "REJECTED") {
    return { outcome: "rejected" };
  }

  const approvalsCount = existingApprovals.filter((a) => a.decision === "APPROVED").length + 1;
  if (approvalsCount >= policy.requiredApprovals) {
    return { outcome: "approved", approvalsCount, requiredApprovals: policy.requiredApprovals };
  }
  return { outcome: "recorded_pending", approvalsCount, requiredApprovals: policy.requiredApprovals };
}
