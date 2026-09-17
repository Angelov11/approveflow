import type { WebClient } from "@slack/web-api";

/** Derived from the installed @slack/web-api version's own `views.open` argument type — see build-request-modal.ts for why. */
export type ModalView = Parameters<WebClient["views"]["open"]>[0]["view"];

export const CONFIGURE_POLICY_CALLBACK_ID = "approveflow_configure_policy";

export const POLICY_APPROVERS_BLOCK_ID = "policy_approvers_block";
export const POLICY_APPROVERS_ACTION_ID = "policy_approvers_select";
export const POLICY_REQUIRED_APPROVALS_BLOCK_ID = "policy_required_approvals_block";
export const POLICY_REQUIRED_APPROVALS_ACTION_ID = "policy_required_approvals_select";
export const POLICY_STATUS_BLOCK_ID = "policy_status_block";
export const POLICY_STATUS_ACTION_ID = "policy_status_select";

export const POLICY_STATUS_ACTIVE = "ACTIVE";
export const POLICY_STATUS_DISABLED = "DISABLED";

/** MVP ceiling — this is a small workplace approval tool, not enterprise-scale routing; a hard cap keeps the modal and the required-approvals picker both trivially small. */
export const MAX_POLICY_APPROVERS = 10;
const REQUIRED_APPROVALS_OPTIONS = Array.from({ length: MAX_POLICY_APPROVERS }, (_, i) => String(i + 1));

export interface PolicyModalMetadata {
  requestTypeId: string;
}

export interface ExistingPolicyState {
  approverSlackIds: string[];
  requiredApprovals: number;
  active: boolean;
}

export interface BuildPolicyModalParams {
  requestTypeId: string;
  requestTypeName: string;
  /** Undefined for a type with no policy yet — the modal then starts from sensible empty defaults. */
  existing?: ExistingPolicyState;
}

/**
 * Configure/Edit modal for one request type's approval policy — reused for
 * both "no policy yet" (Configure) and "already has one" (Edit); the only
 * difference is whether `existing` pre-fills the fields. Request Type
 * itself is fixed/read-only (a plain section, not an input) — the acting
 * request_type_id travels via private_metadata as an opaque locator only,
 * NEVER as authorization; the server independently re-validates it belongs
 * to the acting admin's workspace and is active before writing anything
 * (see configure-approval-policy.ts / the configure_approval_policy RPC).
 *
 * No separate "Name" field: the policy's display name is derived
 * server-side from the request type's own name — one fewer thing for an
 * admin to type, and this app has no use for an admin-curated policy name
 * beyond what already appears everywhere else in the product.
 */
export function buildPolicyModal({ requestTypeId, requestTypeName, existing }: BuildPolicyModalParams): ModalView {
  const metadata: PolicyModalMetadata = { requestTypeId };

  return {
    type: "modal",
    callback_id: CONFIGURE_POLICY_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "Approval Policy" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Request Type*\n${requestTypeName}` },
      },
      { type: "divider" },
      {
        type: "input",
        block_id: POLICY_APPROVERS_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Approvers" },
        element: {
          type: "multi_users_select",
          action_id: POLICY_APPROVERS_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select approvers" },
          max_selected_items: MAX_POLICY_APPROVERS,
          ...(existing?.approverSlackIds.length ? { initial_users: existing.approverSlackIds } : {}),
        },
      },
      {
        type: "input",
        block_id: POLICY_REQUIRED_APPROVALS_BLOCK_ID,
        label: { type: "plain_text", text: "Required approvals" },
        element: {
          type: "static_select",
          action_id: POLICY_REQUIRED_APPROVALS_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a number" },
          options: REQUIRED_APPROVALS_OPTIONS.map((n) => ({ text: { type: "plain_text", text: n }, value: n })),
          initial_option: {
            text: { type: "plain_text", text: String(existing?.requiredApprovals ?? 1) },
            value: String(existing?.requiredApprovals ?? 1),
          },
        },
      },
      {
        type: "input",
        block_id: POLICY_STATUS_BLOCK_ID,
        label: { type: "plain_text", text: "Status" },
        element: {
          type: "static_select",
          action_id: POLICY_STATUS_ACTION_ID,
          options: [
            { text: { type: "plain_text", text: "Active" }, value: POLICY_STATUS_ACTIVE },
            { text: { type: "plain_text", text: "Disabled" }, value: POLICY_STATUS_DISABLED },
          ],
          initial_option:
            existing?.active === false
              ? { text: { type: "plain_text", text: "Disabled" }, value: POLICY_STATUS_DISABLED }
              : { text: { type: "plain_text", text: "Active" }, value: POLICY_STATUS_ACTIVE },
        },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Changing approvers affects pending requests already routed under this policy — required approvals stay whatever they were when each request was created, but who can decide it updates immediately.",
          },
        ],
      },
    ],
  } as ModalView;
}
