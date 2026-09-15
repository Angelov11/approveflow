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
      values?: Record<string, Record<string, { value?: string | null; selected_option?: { value?: string } | null }>>;
    };
  };
}

export interface ValidatedRequestSubmission {
  slackTeamId: string;
  slackUserId: string;
  idempotencyKey: string;
  requestTypeKey: string;
  resource: string;
  reason: string;
  requestedDurationMinutes: number | null;
}

export type RequestSubmissionResult =
  | { ok: true; data: ValidatedRequestSubmission }
  | { ok: false; errors: Record<string, string> };

const MAX_RESOURCE_LENGTH = 200;
const MAX_REASON_LENGTH = 2000;

function getFieldValue(payload: ViewSubmissionPayload, blockId: string, actionId: string): string | undefined {
  const field = payload.view?.state?.values?.[blockId]?.[actionId];
  return field?.selected_option?.value ?? field?.value ?? undefined;
}

/**
 * Validates a view_submission payload structurally and against business
 * rules. Does NOT touch the database — `validRequestTypeKeys` is passed in
 * by the caller (resolved fresh from the workspace's own request_types
 * rows), so this stays pure and unit-testable.
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
    errors.resource_block = "Resource is required.";
  } else if (resource.length > MAX_RESOURCE_LENGTH) {
    errors.resource_block = `Resource must be ${MAX_RESOURCE_LENGTH} characters or fewer.`;
  }

  const reason = getFieldValue(payload, "reason_block", "reason_input")?.trim() ?? "";
  if (reason.length === 0) {
    errors.reason_block = "Reason is required.";
  } else if (reason.length > MAX_REASON_LENGTH) {
    errors.reason_block = `Reason must be ${MAX_REASON_LENGTH} characters or fewer.`;
  }

  const durationValue = getFieldValue(payload, "duration_block", "duration_select");
  const requestedDurationMinutes = durationValue ? resolveDurationMinutes(durationValue) : undefined;
  if (durationValue === undefined || requestedDurationMinutes === undefined) {
    errors.duration_block = "Please select a valid duration.";
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
      reason,
      requestedDurationMinutes: requestedDurationMinutes as number | null,
    },
  };
}
