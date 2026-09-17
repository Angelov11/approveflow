import "server-only";

import { listActiveRequestTypes } from "@/lib/requests/request-types";
import { upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ConfigureApprovalPolicyOutcome } from "@/types/admin";

export interface ConfigureApprovalPolicyParams {
  workspaceId: string;
  requestTypeId: string;
  requiredApprovals: number;
  active: boolean;
  approverSlackIds: string[];
  policyName: string;
}

/**
 * Thin wrapper around the atomic `configure_approval_policy` RPC — see its
 * migration header for the atomicity/validation it provides. Resolves each
 * selected Slack user into an internal `users.id` first (an admin may add
 * an approver who has never interacted with ApproveFlow before), then
 * hands the RPC only internal IDs — never raw Slack user IDs — so the
 * RPC's own "does this approver belong to this workspace" check has
 * something meaningful to verify against.
 *
 * Does NOT authorize the acting admin — callers must call
 * isWorkspaceAdmin() first, exactly like removeWorkspaceAdmin().
 */
export async function configureApprovalPolicy(params: ConfigureApprovalPolicyParams): Promise<ConfigureApprovalPolicyOutcome> {
  const { workspaceId, requestTypeId, requiredApprovals, active, approverSlackIds, policyName } = params;

  const approverUsers = await Promise.all(approverSlackIds.map((slackUserId) => upsertSlackUser(workspaceId, slackUserId)));

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("configure_approval_policy", {
    p_workspace_id: workspaceId,
    p_request_type_id: requestTypeId,
    p_name: policyName,
    p_required_approvals: requiredApprovals,
    p_active: active,
    p_approver_user_ids: approverUsers.map((u) => u.id),
  });

  if (error) {
    throw new Error(`configure_approval_policy failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.outcome) {
    throw new Error("configure_approval_policy returned no result");
  }
  return row.outcome as ConfigureApprovalPolicyOutcome;
}

export interface PolicySummary {
  requestTypeId: string;
  requestTypeKey: string;
  requestTypeName: string;
  policy: { approverSlackIds: string[]; requiredApprovals: number; active: boolean } | null;
}

interface PolicyRow {
  request_type_id: string;
  required_approvals: number;
  active: boolean;
  approval_policy_members: { users: { slack_user_id: string } | { slack_user_id: string }[] | null }[] | null;
}

function toApproverSlackIds(members: PolicyRow["approval_policy_members"]): string[] {
  return (members ?? [])
    .map((m) => (Array.isArray(m.users) ? m.users[0] : m.users)?.slack_user_id)
    .filter((slackId): slackId is string => Boolean(slackId));
}

/** For the "Manage Approval Policies" list view — one row per active request type, with its current policy (if any) or null. */
export async function listPolicySummaries(workspaceId: string): Promise<PolicySummary[]> {
  const requestTypes = await listActiveRequestTypes(workspaceId);

  const supabase = getSupabaseAdmin();
  const { data: policies, error } = await supabase
    .from("approval_policies")
    .select("request_type_id, required_approvals, active, approval_policy_members(users(slack_user_id))")
    .eq("workspace_id", workspaceId)
    .eq("active", true);
  if (error) {
    throw new Error(`Failed to list approval policies: ${error.message}`);
  }

  const byRequestTypeId = new Map((policies ?? []).map((p) => [p.request_type_id, p as PolicyRow]));

  return requestTypes.map((requestType) => {
    const policy = byRequestTypeId.get(requestType.id);
    return {
      requestTypeId: requestType.id,
      requestTypeKey: requestType.key,
      requestTypeName: requestType.name,
      policy: policy
        ? { approverSlackIds: toApproverSlackIds(policy.approval_policy_members), requiredApprovals: policy.required_approvals, active: policy.active }
        : null,
    };
  });
}

/** For opening the Configure/Edit modal pre-filled — looks up ANY existing policy row for this type, active or disabled, matching configure_approval_policy's own "edit the same logical policy" semantics. */
export async function getPolicyForRequestType(
  workspaceId: string,
  requestTypeId: string,
): Promise<{ approverSlackIds: string[]; requiredApprovals: number; active: boolean } | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("approval_policies")
    .select("required_approvals, active, approval_policy_members(users(slack_user_id))")
    .eq("workspace_id", workspaceId)
    .eq("request_type_id", requestTypeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load policy for request type: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return { approverSlackIds: toApproverSlackIds(data.approval_policy_members), requiredApprovals: data.required_approvals, active: data.active };
}
