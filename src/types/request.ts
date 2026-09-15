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
  created_at: string;
  updated_at: string;
}
