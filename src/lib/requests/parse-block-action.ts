import { APPROVE_ACTION_ID, REJECT_ACTION_ID } from "./build-approval-notification.ts";

/**
 * Minimal shape of a Slack `block_actions` interaction payload — just the
 * fields this app reads, hand-written against Slack's documented payload
 * shape (same rationale as ViewSubmissionPayload in
 * validate-request-submission.ts: @slack/web-api doesn't type inbound
 * interaction payloads).
 */
export interface BlockActionsPayload {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  actions?: { action_id?: string; value?: string }[];
  channel?: { id?: string };
  message?: { ts?: string; blocks?: unknown[] };
}

export interface ParsedApprovalAction {
  slackTeamId: string;
  slackUserId: string;
  actionId: typeof APPROVE_ACTION_ID | typeof REJECT_ACTION_ID;
  requestId: string;
  channelId: string;
  messageTs: string;
  /** The original message's blocks, reused when updating it (see the interactions route) so request details aren't lost. */
  messageBlocks: unknown[];
}

export type ParseBlockActionResult = { ok: true; data: ParsedApprovalAction } | { ok: false; reason: string };

/**
 * Structural validation only — the button `value` is an opaque request-id
 * carrier, NOT an authorization claim. It only tells the caller which
 * request this click refers to; the interactions route re-resolves
 * workspace/user from the trusted payload envelope and defers all
 * authorization to decide_on_request().
 */
export function parseApprovalBlockAction(payload: BlockActionsPayload): ParseBlockActionResult {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const channelId = payload.channel?.id;
  const messageTs = payload.message?.ts;
  if (!slackTeamId || !slackUserId || !channelId || !messageTs) {
    return { ok: false, reason: "missing_identifiers" };
  }

  const action = payload.actions?.[0];
  if (!action || (action.action_id !== APPROVE_ACTION_ID && action.action_id !== REJECT_ACTION_ID)) {
    return { ok: false, reason: "unknown_action" };
  }

  let requestId: string | undefined;
  try {
    const value = action.value ? JSON.parse(action.value) : undefined;
    requestId = typeof value?.requestId === "string" ? value.requestId : undefined;
  } catch {
    requestId = undefined;
  }
  if (!requestId) {
    return { ok: false, reason: "missing_request_id" };
  }

  return {
    ok: true,
    data: {
      slackTeamId,
      slackUserId,
      actionId: action.action_id,
      requestId,
      channelId,
      messageTs,
      messageBlocks: payload.message?.blocks ?? [],
    },
  };
}
