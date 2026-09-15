/**
 * Pure mirror of supabase/migrations/*_update_decide_on_request_for_direct_routing.sql
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

/**
 * Mirrors requests.routing_type + the fields it gates, frozen at request
 * creation (see the M4 schema migration). "POLICY_MISSING" models a
 * POLICY-routed request whose approval_policy_id is null (a historical
 * backfill gap, or a since-deleted policy) — nobody can decide on it.
 */
export type RoutingAuthorization =
  | { type: "POLICY"; policyMemberIds: string[] }
  | { type: "POLICY_MISSING" }
  | { type: "DIRECT"; directApproverId: string };

export interface DecisionInputs {
  requestExists: boolean;
  requestStatus: RequestStatusForDecision;
  /** Snapshotted on the request row — always 1 for DIRECT, the policy's value at creation time for POLICY. */
  requiredApprovals: number;
  routing: RoutingAuthorization;
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
  const { requestExists, requestStatus, requiredApprovals, routing, existingApprovals, approverId, decision } = inputs;

  if (!requestExists) {
    return { outcome: "not_found" };
  }
  if (requestStatus !== "PENDING") {
    return { outcome: "already_final", requestStatus };
  }

  let isAuthorized: boolean;
  if (routing.type === "POLICY_MISSING") {
    return { outcome: "no_policy", requestStatus };
  } else if (routing.type === "POLICY") {
    isAuthorized = routing.policyMemberIds.includes(approverId);
  } else {
    isAuthorized = routing.directApproverId === approverId;
  }

  if (!isAuthorized) {
    return { outcome: "unauthorized", requestStatus };
  }
  if (existingApprovals.some((a) => a.approverId === approverId)) {
    return { outcome: "already_decided", requestStatus };
  }

  if (decision === "REJECTED") {
    return { outcome: "rejected" };
  }

  const approvalsCount = existingApprovals.filter((a) => a.decision === "APPROVED").length + 1;
  if (approvalsCount >= requiredApprovals) {
    return { outcome: "approved", approvalsCount, requiredApprovals };
  }
  return { outcome: "recorded_pending", approvalsCount, requiredApprovals };
}
