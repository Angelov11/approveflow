/** Row shape of the `workspace_admins` table (see supabase/migrations, M9). */
export interface WorkspaceAdmin {
  workspace_id: string;
  user_id: string;
  granted_at: string;
  /** Null means granted by the initial-install bootstrap, not "unknown". */
  granted_by: string | null;
}

/** Return shape of the `install_or_reinstall_workspace()` RPC. */
export interface InstallOrReinstallWorkspaceResult {
  workspace_id: string;
  is_new_workspace: boolean;
}

/** Return shape of the `remove_workspace_admin()` RPC. */
export type RemoveWorkspaceAdminOutcome = "removed" | "last_admin" | "not_admin" | "workspace_not_found" | "billing_owner_blocked";

/** Return shape of the `configure_approval_policy()` RPC. */
export type ConfigureApprovalPolicyOutcome =
  | "ok"
  | "invalid_name"
  | "invalid_threshold"
  | "invalid_request_type"
  | "inactive_request_type"
  | "duplicate_approvers"
  | "no_approvers"
  | "threshold_exceeds_approvers"
  | "invalid_approver"
  | "pro_required";

export interface ConfigureApprovalPolicyResult {
  policy_id: string | null;
  outcome: ConfigureApprovalPolicyOutcome;
}
