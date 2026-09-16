import { resolveDurationMinutes } from "./duration-options.ts";

/**
 * Minimal shape of a Slack `view_submission` interaction payload — just the
 * fields this app reads. @slack/web-api doesn't type inbound interaction
 * payloads (it's an outbound API client), so this is hand-written against
 * Slack's documented payload shape rather than imported from an SDK.
 */
export interface ViewSubmissionPayload {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string | null; selected_option?: { value?: string } | null; selected_user?: string | null }>
      >;
    };
  };
}

export interface ValidatedRequestSubmission {
  slackTeamId: string;
  slackUserId: string;
  idempotencyKey: string;
  requestTypeKey: string;
  /** M8: "Details" in the UI — free-text description of the request. Stored in the `resource` column (unrenamed; see build-request-modal.ts). */
  resource: string;
  requestedDurationMinutes: number | null;
  /** The Slack user ID selected via the modal's native picker — an identifier only, not an authorization claim. See the interactions route for how it's actually used (or discarded) depending on routing. */
  selectedApproverSlackId: string;
}

export type RequestSubmissionResult =
  | { ok: true; data: ValidatedRequestSubmission }
  | { ok: false; errors: Record<string, string> };

const MAX_DETAILS_LENGTH = 200;
// Slack user IDs are alphanumeric, conventionally starting with U (or W for
// some legacy/shared-channel cases) — a light format check against a
// forged/malformed value, not full validation (Slack's own picker already
// guarantees a well-formed ID under normal use).
const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{2,}$/i;

function getFieldValue(payload: ViewSubmissionPayload, blockId: string, actionId: string): string | undefined {
  const field = payload.view?.state?.values?.[blockId]?.[actionId];
  return field?.selected_option?.value ?? field?.selected_user ?? field?.value ?? undefined;
}

/**
 * Validates a view_submission payload structurally and against business
 * rules. Does NOT touch the database — `validRequestTypeKeys` is passed in
 * by the caller (resolved fresh from the workspace's own request_types
 * rows), so this stays pure and unit-testable.
 *
 * M8: no longer collects a separate "Reason" — merged into "Details"
 * (resource_block). The database's `reason` column is nullable and simply
 * left unpopulated for new submissions (see the interactions route); no
 * fabricated/duplicated content is written to it.
 */
export function validateRequestSubmission(
  payload: ViewSubmissionPayload,
  { validRequestTypeKeys }: { validRequestTypeKeys: readonly string[] },
): RequestSubmissionResult {
  const errors: Record<string, string> = {};

  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!slackTeamId || !slackUserId) {
    // Missing top-level Slack identifiers means this isn't a payload worth
    // processing at all — not a per-field validation error.
    return { ok: false, errors: { request_type_block: "Could not identify the Slack workspace or user." } };
  }

  let idempotencyKey: string | undefined;
  try {
    const metadata = payload.view?.private_metadata ? JSON.parse(payload.view.private_metadata) : undefined;
    idempotencyKey = typeof metadata?.idempotencyKey === "string" ? metadata.idempotencyKey : undefined;
  } catch {
    idempotencyKey = undefined;
  }
  if (!idempotencyKey) {
    return { ok: false, errors: { request_type_block: "This request could not be verified. Please run /request again." } };
  }

  const requestTypeKey = getFieldValue(payload, "request_type_block", "request_type_select");
  if (!requestTypeKey || !validRequestTypeKeys.includes(requestTypeKey)) {
    errors.request_type_block = "Please select a valid request type.";
  }

  const resource = getFieldValue(payload, "resource_block", "resource_input")?.trim() ?? "";
  if (resource.length === 0) {
    errors.resource_block = "Details are required.";
  } else if (resource.length > MAX_DETAILS_LENGTH) {
    errors.resource_block = `Details must be ${MAX_DETAILS_LENGTH} characters or fewer.`;
  }

  const durationValue = getFieldValue(payload, "duration_block", "duration_select");
  const requestedDurationMinutes = durationValue ? resolveDurationMinutes(durationValue) : undefined;
  if (durationValue === undefined || requestedDurationMinutes === undefined) {
    errors.duration_block = "Please select when / how long.";
  }

  // Required even though a POLICY-routed submission will end up ignoring
  // it server-side — the modal can't know client-side whether a policy
  // exists for the currently-selected request type without dynamic modal
  // mutation, which M4 deliberately doesn't implement. See build-request-
  // modal.ts's hint text and the interactions route for how this is
  // resolved/discarded depending on routing.
  const selectedApproverSlackId = getFieldValue(payload, "approver_block", "approver_select");
  if (!selectedApproverSlackId || !SLACK_USER_ID_PATTERN.test(selectedApproverSlackId)) {
    errors.approver_block = "Please select an approver.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      slackTeamId,
      slackUserId,
      idempotencyKey,
      requestTypeKey: requestTypeKey as string,
      resource,
      requestedDurationMinutes: requestedDurationMinutes as number | null,
      selectedApproverSlackId: selectedApproverSlackId as string,
    },
  };
}
