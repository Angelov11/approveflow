export interface ApprovalPolicy {
  id: string;
  workspace_id: string;
  request_type_id: string;
  name: string;
  required_approvals: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApprovalPolicyMember {
  policy_id: string;
  user_id: string;
  created_at: string;
}

export type Decision = "APPROVED" | "REJECTED";

export interface Approval {
  id: string;
  request_id: string;
  approver_id: string;
  decision: Decision;
  comment: string | null;
  decided_at: string;
  created_at: string;
}

/** Return shape of the public.decide_on_request() RPC. */
export interface DecideOnRequestResult {
  outcome:
    | "not_found"
    | "already_final"
    | "no_policy"
    | "unauthorized"
    | "already_decided"
    | "rejected"
    | "approved"
    | "recorded_pending";
  request_status: string | null;
  approvals_count: number | null;
  required_approvals: number | null;
}
