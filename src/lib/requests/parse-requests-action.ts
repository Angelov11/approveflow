export const VIEW_REQUEST_ACTION_ID = "view_request";
export const VIEW_WAITING_REQUESTS_ACTION_ID = "view_waiting_requests";

/**
 * Minimal shape needed to parse a navigation click within the /requests
 * modal flow (Request Center / Waiting for Me / Request Details). Always
 * originates from inside a modal, so a fresh `trigger_id` is always
 * present — required for the views.push call that follows.
 */
export interface RequestsNavigationPayload {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  trigger_id?: string;
  actions?: { action_id?: string; value?: string }[];
}

export type ParsedRequestsNavigation =
  | { actionId: typeof VIEW_REQUEST_ACTION_ID; requestId: string; slackTeamId: string; slackUserId: string; triggerId: string }
  | { actionId: typeof VIEW_WAITING_REQUESTS_ACTION_ID; slackTeamId: string; slackUserId: string; triggerId: string };

export type ParseRequestsNavigationResult = { ok: true; data: ParsedRequestsNavigation } | { ok: false; reason: string };

/** The button `value` (a request id) is an opaque locator only — every downstream lookup still revalidates workspace ownership. */
export function parseRequestsNavigationAction(payload: RequestsNavigationPayload): ParseRequestsNavigationResult {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  if (!slackTeamId || !slackUserId || !triggerId) {
    return { ok: false, reason: "missing_identifiers" };
  }

  const action = payload.actions?.[0];
  if (!action) {
    return { ok: false, reason: "unknown_action" };
  }

  if (action.action_id === VIEW_WAITING_REQUESTS_ACTION_ID) {
    return { ok: true, data: { actionId: VIEW_WAITING_REQUESTS_ACTION_ID, slackTeamId, slackUserId, triggerId } };
  }

  if (action.action_id === VIEW_REQUEST_ACTION_ID) {
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
    return { ok: true, data: { actionId: VIEW_REQUEST_ACTION_ID, requestId, slackTeamId, slackUserId, triggerId } };
  }

  return { ok: false, reason: "unknown_action" };
}
