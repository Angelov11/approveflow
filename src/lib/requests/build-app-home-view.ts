import type { WebClient } from "@slack/web-api";

import { buildRequestRowBlocks, type RequestSummary } from "./build-requests-views.ts";
import { CREATE_REQUEST_ACTION_ID, OPEN_REQUEST_CENTER_ACTION_ID, VIEW_WAITING_REQUESTS_ACTION_ID } from "./parse-requests-action.ts";

/** Derived from the installed @slack/web-api version's own `views.publish` argument type — see build-request-modal.ts for why. */
export type HomeView = Parameters<WebClient["views"]["publish"]>[0]["view"];

/** Home is a summary, not the full Request Center — deliberately smaller than the M5 "/requests" page size. */
export const HOME_RECENT_REQUESTS_LIMIT = 3;

export interface BuildAppHomeViewParams {
  /** Already limited to HOME_RECENT_REQUESTS_LIMIT by the caller (see request-views.ts's `limit` param) — this builder just renders whatever it's given. */
  recentRequests: RequestSummary[];
  waitingCount: number;
}

/**
 * The persistent App Home tab: a front door over the existing product, not
 * a second one. "My Requests" rows reuse the exact same row-block shape as
 * the M5 Request Center (including its View button/action id), and
 * "Waiting for Me" reuses the same waiting-list button — so a click here
 * lands on the identical M5 view-builders, just opened as a fresh modal
 * (see parse-requests-action.ts's `origin` field) instead of pushed onto
 * one already open.
 */
export function buildAppHomeView({ recentRequests, waitingCount }: BuildAppHomeViewParams): HomeView {
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*ApproveFlow*\nRequest access, get approvals, and track decisions — right here in Slack.",
      },
    },
    {
      type: "actions",
      block_id: "home_actions",
      elements: [
        { type: "button", action_id: CREATE_REQUEST_ACTION_ID, style: "primary", text: { type: "plain_text", text: "Create Request" } },
        { type: "button", action_id: OPEN_REQUEST_CENTER_ACTION_ID, text: { type: "plain_text", text: "Open Request Center" } },
      ],
    },
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "My Requests" } },
  ];

  if (recentRequests.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "You haven't submitted any requests yet." } });
  } else {
    blocks.push(...buildRequestRowBlocks(recentRequests));
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

  return { type: "home", blocks } as HomeView;
}
