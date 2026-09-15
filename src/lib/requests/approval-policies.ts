import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface ActivePolicy {
  id: string;
  required_approvals: number;
}

/** The active policy for a request type, if any — used at request-creation time to decide POLICY vs DIRECT routing. */
export async function findActivePolicyForRequestType(workspaceId: string, requestTypeId: string): Promise<ActivePolicy | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("approval_policies")
    .select("id, required_approvals")
    .eq("workspace_id", workspaceId)
    .eq("request_type_id", requestTypeId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up active approval policy: ${error.message}`);
  }
  return data;
}

export interface PolicyRecipient {
  slack_user_id: string;
  display_name: string | null;
}

/** Slack identities of a policy's members, for sending the approval DM to each. */
export async function listPolicyRecipients(policyId: string): Promise<PolicyRecipient[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("approval_policy_members").select("users(slack_user_id, display_name)").eq("policy_id", policyId);

  if (error) {
    throw new Error(`Failed to list policy members: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => (Array.isArray(row.users) ? row.users[0] : row.users))
    .filter((user): user is PolicyRecipient => Boolean(user));
}
