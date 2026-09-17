import {
  POLICY_APPROVERS_ACTION_ID,
  POLICY_APPROVERS_BLOCK_ID,
  POLICY_REQUIRED_APPROVALS_ACTION_ID,
  POLICY_REQUIRED_APPROVALS_BLOCK_ID,
  POLICY_STATUS_ACTION_ID,
  POLICY_STATUS_ACTIVE,
  POLICY_STATUS_BLOCK_ID,
  type PolicyModalMetadata,
} from "./build-policy-modal.ts";

/**
 * Minimal shape of a Slack `view_submission` payload for the M9 policy
 * configuration modal — hand-written against Slack's documented shape,
 * same rationale as every other *SubmissionPayload type in this app (no
 * SDK types inbound interaction payloads).
 */
export interface PolicySubmissionPayload {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { selected_users?: string[] | null; selected_option?: { value?: string } | null }>
      >;
    };
  };
}

export interface ValidatedPolicySubmission {
  slackTeamId: string;
  slackUserId: string;
  requestTypeId: string;
  approverSlackIds: string[];
  requiredApprovals: number;
  active: boolean;
}

export type ValidatePolicySubmissionResult = { ok: true; data: ValidatedPolicySubmission } | { ok: false; errors: Record<string, string> };

/**
 * Validates the modal's structure and the business rules that DON'T need
 * database state (an active policy needs >=1 approver; required approvals
 * can't exceed the approver count) — the rules that DO need database state
 * (does this request_type_id really belong to this workspace and is it
 * active; do these Slack user IDs really resolve to workspace members) are
 * intentionally NOT duplicated here and are enforced authoritatively by the
 * configure_approval_policy RPC. `requestTypeId` comes from
 * `private_metadata` as an opaque locator ONLY — never treated as
 * authorization; identity always comes from the signed `payload.team`/
 * `payload.user` envelope, exactly like every other interaction in this app.
 */
export function validatePolicySubmission(payload: PolicySubmissionPayload): ValidatePolicySubmissionResult {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!slackTeamId || !slackUserId) {
    return { ok: false, errors: { [POLICY_APPROVERS_BLOCK_ID]: "Could not identify the Slack workspace or user. Please try again." } };
  }

  let requestTypeId: string | undefined;
  try {
    const metadata: PolicyModalMetadata | undefined = payload.view?.private_metadata ? JSON.parse(payload.view.private_metadata) : undefined;
    requestTypeId = typeof metadata?.requestTypeId === "string" ? metadata.requestTypeId : undefined;
  } catch {
    requestTypeId = undefined;
  }
  if (!requestTypeId) {
    return { ok: false, errors: { [POLICY_APPROVERS_BLOCK_ID]: "This policy could not be verified. Please reopen Manage Approval Policies and try again." } };
  }

  const values = payload.view?.state?.values ?? {};
  const approverSlackIds = values[POLICY_APPROVERS_BLOCK_ID]?.[POLICY_APPROVERS_ACTION_ID]?.selected_users ?? [];
  const requiredApprovalsRaw = values[POLICY_REQUIRED_APPROVALS_BLOCK_ID]?.[POLICY_REQUIRED_APPROVALS_ACTION_ID]?.selected_option?.value;
  const statusRaw = values[POLICY_STATUS_BLOCK_ID]?.[POLICY_STATUS_ACTION_ID]?.selected_option?.value;

  const requiredApprovals = requiredApprovalsRaw ? Number(requiredApprovalsRaw) : NaN;
  if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1) {
    return { ok: false, errors: { [POLICY_REQUIRED_APPROVALS_BLOCK_ID]: "Select how many approvals are required." } };
  }

  const active = statusRaw === POLICY_STATUS_ACTIVE;

  const uniqueApproverIds = new Set(approverSlackIds);
  if (uniqueApproverIds.size !== approverSlackIds.length) {
    return { ok: false, errors: { [POLICY_APPROVERS_BLOCK_ID]: "The same approver was selected more than once." } };
  }

  if (active && approverSlackIds.length === 0) {
    return { ok: false, errors: { [POLICY_APPROVERS_BLOCK_ID]: "An active policy needs at least one approver." } };
  }
  if (active && requiredApprovals > approverSlackIds.length) {
    return { ok: false, errors: { [POLICY_REQUIRED_APPROVALS_BLOCK_ID]: "Required approvals can't exceed the number of selected approvers." } };
  }

  return {
    ok: true,
    data: { slackTeamId, slackUserId, requestTypeId, approverSlackIds, requiredApprovals, active },
  };
}
