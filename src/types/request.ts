export interface User {
  id: string;
  workspace_id: string;
  slack_user_id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestType {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  description: string | null;
  requires_duration: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";

/** Frozen at creation — see the M4 migration adding these columns for why this is never re-derived later. */
export type RoutingType = "POLICY" | "DIRECT";

export interface RequestRow {
  id: string;
  workspace_id: string;
  requester_id: string;
  request_type_id: string;
  resource: string;
  reason: string;
  requested_duration_minutes: number | null;
  status: RequestStatus;
  idempotency_key: string;
  routing_type: RoutingType;
  /** Snapshotted policy id for POLICY routing. Null for DIRECT requests and for historical rows with no identifiable policy at backfill time. */
  approval_policy_id: string | null;
  /** The requester-selected Slack user's internal id, for DIRECT routing only. */
  direct_approver_id: string | null;
  /** Snapshotted at creation — always 1 for DIRECT. */
  required_approval_count: number;
  created_at: string;
  updated_at: string;
}
