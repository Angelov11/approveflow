import type { WebClient } from "@slack/web-api";

import type { BillingActions } from "../billing/billing-actions.ts";
import type { WorkspacePlan } from "../../types/billing.ts";
import { MANAGE_ADMINISTRATORS_ACTION_ID, MANAGE_BILLING_ACTION_ID, MANAGE_POLICIES_ACTION_ID, UPGRADE_TO_PRO_ACTION_ID } from "./build-admin-views.ts";
import { buildRequestRowBlocks, type RequestSummary } from "./build-requests-views.ts";
import { CREATE_REQUEST_ACTION_ID, OPEN_REQUEST_CENTER_ACTION_ID, VIEW_WAITING_REQUESTS_ACTION_ID } from "./parse-requests-action.ts";

/** Derived from the installed @slack/web-api version's own `views.publish` argument type — see build-request-modal.ts for why. */
export type HomeView = Parameters<WebClient["views"]["publish"]>[0]["view"];

/** Home is a summary, not the full Request Center — deliberately smaller than the M5 "/requests" page size. */
export const HOME_RECENT_REQUESTS_LIMIT = 3;

export interface BuildAppHomeViewParams {
  /** Already limited to HOME_RECENT_REQUESTS_LIMIT by the caller (see request-views.ts's `limit` param) — this builder just renders whatever it's given. */
  recentRequests: RequestSummary[];
  /** The requester's TOTAL request count (not just the ones shown) — used only to decide whether "View all requests" is worth showing. */
  myRequestsTotalCount: number;
  waitingCount: number;
  /** M9: whether the viewer currently holds an admin grant for this workspace — resolved server-side (isWorkspaceAdmin) by the caller, never inferred here. Hiding the Administration section for a non-admin is UX only; every action inside it independently reauthorizes regardless of whether this flag was ever true. */
  isAdmin: boolean;
  /**
   * M10.2: resolved server-side via getWorkspaceBillingState — never inferred
   * here. Only used inside the admin-only Billing section for the status
   * label ("Pro"/"Free"); which BUTTONS are shown is governed separately by
   * `billingActions` below. Product entitlement and billing-action
   * visibility are deliberately different concepts — see billing-actions.ts.
   */
  plan: WorkspacePlan;
  /** M10.3: which billing buttons to show — independent of `plan`. See billing-actions.ts for why a paused/canceled workspace (plan === "FREE") can still show "Manage Billing", and canceled can show both buttons. */
  billingActions: BillingActions;
  /**
   * POST-M11-B2 (corrected): whether the viewer is authorized to actually
   * use "Manage Billing" — the caller must compute this with the EXACT
   * SAME fail-closed predicate as handleManageBilling's own pre-check:
   * billing_owner_user_id IS NOT NULL AND equals the viewer's internal
   * user id. There is NO null-owner exception — a subscription without a
   * recorded owner has NO authorized manager, so this is false for every
   * viewer until a fresh, validated checkout establishes one. This
   * builder never reasons about ownership semantics itself; it only
   * renders what it's told. "Upgrade Again" is NEVER gated by this — any
   * admin may start a fresh checkout on a canceled subscription
   * regardless of who (if anyone) owned the old one (see
   * admin-interaction-handlers.ts).
   */
  isBillingOwner: boolean;
  /**
   * POST-M11-B2: the current owner's Slack user id, for "Managed by <@X>"
   * copy shown to non-owner admins — null when no owner is recorded (a
   * legacy row, or a subscription whose initiating user never validated).
   * Never rendered as an implied responsible party when null — the
   * caller (getWorkspaceBillingState) only resolves this lookup at all
   * when an owner id exists. Irrelevant when isBillingOwner is true.
   */
  billingOwnerSlackUserId: string | null;
}

/**
 * The persistent App Home tab: a front door over the existing product, not
 * a second one. Home is now the primary navigation surface — there is no
 * separate top-level "Open Request Center" button; "My Requests" rows reuse
 * the exact same row-block shape as the M5 Request Center (including its
 * View button/action id), "View all requests" reuses the exact same M5
 * Request Center view (same action id as before, just relocated — see
 * interactions/route.ts, unchanged), and "Waiting for Me" reuses the same
 * waiting-list button — so a click anywhere here lands on an identical M5
 * view-builder, just opened as a fresh modal (see parse-requests-action.ts's
 * `origin` field) instead of pushed onto one already open. `/requests`
 * still opens this same Request Center directly, as a shortcut.
 */
export function buildAppHomeView({
  recentRequests,
  myRequestsTotalCount,
  waitingCount,
  isAdmin,
  plan,
  billingActions,
  isBillingOwner,
  billingOwnerSlackUserId,
}: BuildAppHomeViewParams): HomeView {
  const managedByCopy = !isBillingOwner && billingOwnerSlackUserId ? `\nManaged by <@${billingOwnerSlackUserId}>.` : "";
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*ApproveGo*\nSimple approvals for Slack. Request time off, schedule changes, purchases, and more — without leaving Slack.",
      },
    },
    {
      type: "actions",
      block_id: "home_actions",
      elements: [{ type: "button", action_id: CREATE_REQUEST_ACTION_ID, style: "primary", text: { type: "plain_text", text: "Create Request" } }],
    },
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "My Requests" } },
  ];

  if (recentRequests.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "You haven't submitted any requests yet." } });
  } else {
    blocks.push(...buildRequestRowBlocks(recentRequests));
  }

  // Only worth surfacing once there's actually more to see than what's
  // already shown — mirrors the M5 Request Center's own "showing your N
  // most recent" threshold (myRequestsTotalCount > shown length).
  if (myRequestsTotalCount > recentRequests.length) {
    blocks.push({
      type: "actions",
      block_id: "home_view_all_requests",
      elements: [{ type: "button", action_id: OPEN_REQUEST_CENTER_ACTION_ID, text: { type: "plain_text", text: "View all requests" } }],
    });
  }

  blocks.push({ type: "divider" }, { type: "header", text: { type: "plain_text", text: "Waiting for Me" } });

  if (waitingCount === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "Nothing is waiting for your approval." } });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${waitingCount}* request${waitingCount === 1 ? "" : "s"} need${waitingCount === 1 ? "s" : ""} your decision.`,
      },
      accessory: {
        type: "button",
        action_id: VIEW_WAITING_REQUESTS_ACTION_ID,
        text: { type: "plain_text", text: "View pending approvals" },
      },
    });
  }

  if (isAdmin) {
    blocks.push(
      { type: "divider" },
      { type: "header", text: { type: "plain_text", text: "Administration" } },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Approval Policies*\nConfigure automatic routing for workplace requests." },
        accessory: { type: "button", action_id: MANAGE_POLICIES_ACTION_ID, text: { type: "plain_text", text: "Manage Approval Policies" } },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Administrators*\nManage who can configure ApproveGo." },
        accessory: { type: "button", action_id: MANAGE_ADMINISTRATORS_ACTION_ID, text: { type: "plain_text", text: "Manage Administrators" } },
      },
    );

    // M10.2/M10.3: Free is technically unmetered today, but that's never
    // rendered as "Unlimited" — see the M10 design notes. Upgrade and Manage
    // Billing only ever generate a signed billing-session URL here; neither
    // calls Paddle itself (see handleUpgradeToPro/handleManageBilling in
    // admin-interaction-handlers.ts). Which buttons appear is governed by
    // billingActions, NOT by plan — a paused or canceled workspace is Free
    // for product-feature purposes (plan === "FREE") but may still have a
    // real billing relationship worth surfacing. See billing-actions.ts.
    if (plan === "PRO") {
      blocks.push(
        isBillingOwner
          ? {
              type: "section",
              text: { type: "mrkdwn", text: "*Billing*\nPro — $19/month per workspace." },
              accessory: { type: "button", action_id: MANAGE_BILLING_ACTION_ID, text: { type: "plain_text", text: "Manage Billing" } },
            }
          : {
              type: "section",
              text: { type: "mrkdwn", text: `*Billing*\nPro — $19/month per workspace.${managedByCopy}` },
            },
      );
    } else if (billingActions.canManageBilling && billingActions.canUpgrade) {
      // Canceled: checkout rules already allow resubscribing, so don't force
      // a choice between billing history and resubscribing — show both.
      // Upgrade Again is available to every admin regardless of ownership;
      // only Manage Billing (viewing the canceled sub's history) is gated.
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Billing*\nFree — your Pro subscription was canceled.${managedByCopy}\n\nApproval Policies are available on Pro.\n\nApproveGo Pro — $19/month per workspace`,
          },
        },
        {
          type: "actions",
          block_id: "home_billing_actions",
          elements: [
            ...(isBillingOwner
              ? [{ type: "button", action_id: MANAGE_BILLING_ACTION_ID, text: { type: "plain_text", text: "Manage Billing" } }]
              : []),
            { type: "button", action_id: UPGRADE_TO_PRO_ACTION_ID, style: "primary", text: { type: "plain_text", text: "Upgrade Again" } },
          ],
        },
      );
    } else if (billingActions.canManageBilling) {
      // Paused: checkout would reject a new attempt anyway (the duplicate-
      // subscription guard blocks it), so only offer Manage Billing.
      blocks.push(
        isBillingOwner
          ? {
              type: "section",
              text: { type: "mrkdwn", text: "*Billing*\nFree — your subscription is paused.\n\nApproval Policies are available on Pro." },
              accessory: { type: "button", action_id: MANAGE_BILLING_ACTION_ID, text: { type: "plain_text", text: "Manage Billing" } },
            }
          : {
              type: "section",
              text: { type: "mrkdwn", text: `*Billing*\nFree — your subscription is paused.${managedByCopy}\n\nApproval Policies are available on Pro.` },
            },
      );
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Billing*\nFree\n\nApproval Policies are available on Pro.\n\nApproveGo Pro — $19/month per workspace",
        },
        accessory: { type: "button", action_id: UPGRADE_TO_PRO_ACTION_ID, style: "primary", text: { type: "plain_text", text: "Upgrade to Pro" } },
      });
    }
  }

  return { type: "home", blocks } as HomeView;
}
