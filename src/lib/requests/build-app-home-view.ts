import type { WebClient } from "@slack/web-api";

import type { WorkspacePlan } from "../../types/billing.ts";
import { MANAGE_ADMINISTRATORS_ACTION_ID, MANAGE_POLICIES_ACTION_ID, UPGRADE_TO_PRO_ACTION_ID } from "./build-admin-views.ts";
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
  /** M10.2: resolved server-side via getWorkspaceEntitlements — never inferred here. Only rendered inside the admin-only Billing section; a non-admin never sees billing controls regardless of this value. */
  plan: WorkspacePlan;
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
export function buildAppHomeView({ recentRequests, myRequestsTotalCount, waitingCount, isAdmin, plan }: BuildAppHomeViewParams): HomeView {
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

    // M10.2: Free is technically unmetered today, but that's never rendered
    // as "Unlimited" — see the M10 design notes. Upgrade only ever generates
    // a signed billing-session URL here; it never calls Paddle itself (see
    // handleUpgradeToPro in admin-interaction-handlers.ts).
    if (plan === "PRO") {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Billing*\nPro — $19/month per workspace." } });
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
