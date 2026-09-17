import type { WebClient } from "@slack/web-api";

import { CONFIGURE_POLICY_ACTION_ID } from "./build-admin-views.ts";
import type { PolicySummary } from "./policy-configuration.ts";

/** Derived from the installed @slack/web-api version's own `views.open` argument type — see build-request-modal.ts for why. */
export type ModalView = Parameters<WebClient["views"]["open"]>[0]["view"];

/**
 * "Manage Approval Policies" — one row per active workplace request type,
 * showing either "No policy — employees choose an approver" or the
 * current policy's approvers (as `<@id>` mentions) and required-approval
 * count. Reuses the EXISTING M3/M4 policy engine unchanged — this is only
 * a Slack-native read of `listPolicySummaries()`. Never a `view_submission`
 * target; each row's button pushes the configure/edit modal (see
 * build-policy-modal.ts) via `views.push`.
 */
export function buildManagePoliciesView(summaries: PolicySummary[]): ModalView {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: "*Approval policies*" } }, { type: "divider" }];

  for (const summary of summaries) {
    const statusText = summary.policy
      ? `${summary.policy.approverSlackIds.map((id) => `<@${id}>`).join(" ")}\n${summary.policy.requiredApprovals} approval${summary.policy.requiredApprovals === 1 ? "" : "s"} required`
      : "No policy — employees choose an approver";

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${summary.requestTypeName}*\n${statusText}` },
      accessory: {
        type: "button",
        action_id: CONFIGURE_POLICY_ACTION_ID,
        text: { type: "plain_text", text: summary.policy ? "Edit" : "Configure" },
        value: summary.requestTypeId,
      },
    });
  }

  return {
    type: "modal",
    title: { type: "plain_text", text: "Approval Policies" },
    close: { type: "plain_text", text: "Done" },
    blocks,
  } as ModalView;
}
