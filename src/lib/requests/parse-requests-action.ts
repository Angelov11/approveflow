export const VIEW_REQUEST_ACTION_ID = "view_request";
export const VIEW_WAITING_REQUESTS_ACTION_ID = "view_waiting_requests";
/** Home-only actions (M6) — no request/waiting-list identifier to carry, just a launch point. */
export const OPEN_REQUEST_CENTER_ACTION_ID = "open_request_center";
export const CREATE_REQUEST_ACTION_ID = "create_request_home";

/**
 * Minimal shape needed to parse a navigation click within the /requests
 * modal flow (Request Center / Waiting for Me / Request Details) OR from
 * the App Home tab (M6). Always carries a fresh `trigger_id` — required for
 * the views.open/views.push call that follows either way.
 */
export interface RequestsNavigationPayload {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  trigger_id?: string;
  /** `view.type` distinguishes a click from an open modal ("modal") vs. the Home tab ("home") — see origin below. */
  view?: { type?: string };
  actions?: { action_id?: string; value?: string }[];
}

/**
 * A Home tab is never part of a modal's view stack, so any Home-originated
 * click must use `views.open` (a new top-level modal); the same click from
 * inside an already-open Request Center modal must use `views.push` (M5,
 * unchanged). This is the one behavioral difference reuse from Home
 * requires — the query/view-building logic itself is identical either way.
 */
export type RequestsNavigationOrigin = "home" | "modal";

export type ParsedRequestsNavigation =
  | { actionId: typeof VIEW_REQUEST_ACTION_ID; requestId: string; slackTeamId: string; slackUserId: string; triggerId: string; origin: RequestsNavigationOrigin }
  | { actionId: typeof VIEW_WAITING_REQUESTS_ACTION_ID; slackTeamId: string; slackUserId: string; triggerId: string; origin: RequestsNavigationOrigin }
  | { actionId: typeof OPEN_REQUEST_CENTER_ACTION_ID; slackTeamId: string; slackUserId: string; triggerId: string; origin: RequestsNavigationOrigin }
  | { actionId: typeof CREATE_REQUEST_ACTION_ID; slackTeamId: string; slackUserId: string; triggerId: string; origin: RequestsNavigationOrigin };

export type ParseRequestsNavigationResult = { ok: true; data: ParsedRequestsNavigation } | { ok: false; reason: string };

/** The button `value` (a request id) is an opaque locator only — every downstream lookup still revalidates workspace ownership. */
export function parseRequestsNavigationAction(payload: RequestsNavigationPayload): ParseRequestsNavigationResult {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  if (!slackTeamId || !slackUserId || !triggerId) {
    return { ok: false, reason: "missing_identifiers" };
  }

  const origin: RequestsNavigationOrigin = payload.view?.type === "home" ? "home" : "modal";

  const action = payload.actions?.[0];
  if (!action) {
    return { ok: false, reason: "unknown_action" };
  }

  if (action.action_id === VIEW_WAITING_REQUESTS_ACTION_ID) {
    return { ok: true, data: { actionId: VIEW_WAITING_REQUESTS_ACTION_ID, slackTeamId, slackUserId, triggerId, origin } };
  }

  if (action.action_id === OPEN_REQUEST_CENTER_ACTION_ID) {
    return { ok: true, data: { actionId: OPEN_REQUEST_CENTER_ACTION_ID, slackTeamId, slackUserId, triggerId, origin } };
  }

  if (action.action_id === CREATE_REQUEST_ACTION_ID) {
    return { ok: true, data: { actionId: CREATE_REQUEST_ACTION_ID, slackTeamId, slackUserId, triggerId, origin } };
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
    return { ok: true, data: { actionId: VIEW_REQUEST_ACTION_ID, requestId, slackTeamId, slackUserId, triggerId, origin } };
  }

  return { ok: false, reason: "unknown_action" };
}
