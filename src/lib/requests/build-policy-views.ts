import type { WebClient } from "@slack/web-api";

import { CONFIGURE_POLICY_ACTION_ID, DISABLE_POLICY_ACTION_ID } from "./build-admin-views.ts";
import type { PolicySummary } from "./policy-configuration.ts";

/** Derived from the installed @slack/web-api version's own `views.open` argument type — see build-request-modal.ts for why. */
export type ModalView = Parameters<WebClient["views"]["open"]>[0]["view"];

export interface BuildManagePoliciesViewOptions {
  /**
   * M10.4: Approval Policy CONFIGURATION is Pro-only — this governs only
   * which button/affordance each row gets, never whether the row (or the
   * policy data itself) is shown. A Free workspace can always see its
   * saved policies and disable them; it can never activate/reconfigure
   * one from here. See resolve-effective-policy.ts for the separate,
   * unrelated question of whether a saved active policy currently governs
   * routing — that's never asked here, this view only reflects configured
   * state.
   */
  canManageApprovalPolicies: boolean;
}

/**
 * "Manage Approval Policies" — one row per active workplace request type,
 * showing either "No policy — employees choose an approver" or the
 * current policy's approvers (as `<@id>` mentions) and required-approval
 * count. Reuses the EXISTING M3/M4 policy engine unchanged — this is only
 * a Slack-native read of `listPolicySummaries()`. Never a `view_submission`
 * target; each row's button pushes the configure/edit modal (see
 * build-policy-modal.ts) via `views.push`, EXCEPT the Free-mode Disable
 * button, which fires a direct in-place action (see handleDisablePolicy)
 * — no modal, no read-only editor to build/maintain.
 *
 * M10.4: policies survive a downgrade untouched in the database (see the
 * M10.4 design notes on why `active` is never redefined), so a Free
 * workspace's previously-configured active policy still shows up here
 * exactly as before — this view's only job is to make clear it isn't
 * currently being applied and to offer the one action Free is always
 * allowed to take (disable), never a way to activate/reconfigure one.
 */
export function buildManagePoliciesView(summaries: PolicySummary[], { canManageApprovalPolicies }: BuildManagePoliciesViewOptions): ModalView {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: "*Approval policies*" } }];

  if (!canManageApprovalPolicies) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Approval Policies require ApproveGo Pro to automatically route requests. Saved policies below remain stored and can be disabled, but won't route new requests until this workspace is on Pro. Manage billing from App Home.",
      },
    });
  }

  blocks.push({ type: "divider" });

  for (const summary of summaries) {
    if (summary.policy && !canManageApprovalPolicies) {
      // Free: view + disable only, never edit/activate.
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${summary.requestTypeName}*\nSaved policy — Pro required for automatic routing\n${summary.policy.approverSlackIds.map((id) => `<@${id}>`).join(" ")}\n${summary.policy.requiredApprovals} approval${summary.policy.requiredApprovals === 1 ? "" : "s"} required`,
        },
        accessory: {
          type: "button",
          action_id: DISABLE_POLICY_ACTION_ID,
          text: { type: "plain_text", text: "Disable" },
          style: "danger",
          value: summary.requestTypeId,
          confirm: {
            title: { type: "plain_text", text: "Disable this policy?" },
            text: { type: "mrkdwn", text: "New requests will use manual approver selection instead. The saved policy configuration is kept." },
            confirm: { type: "plain_text", text: "Disable" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
      });
      continue;
    }

    if (!summary.policy && !canManageApprovalPolicies) {
      // Free, nothing saved: no button at all — configuring one requires Pro.
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${summary.requestTypeName}*\nNo policy — employees choose an approver. Requires Pro to configure.` },
      });
      continue;
    }

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
