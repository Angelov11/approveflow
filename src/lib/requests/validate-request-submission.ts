import {
  EXPENSE_AMOUNT_ACTION_ID,
  EXPENSE_AMOUNT_BLOCK_ID,
  EXPENSE_CURRENCY_ACTION_ID,
  EXPENSE_CURRENCY_BLOCK_ID,
  validateExpense,
  type RequestExpense,
} from "./expense.ts";
import { getRequestTypeFieldConfig } from "./request-type-config.ts";
import {
  END_DATE_ACTION_ID,
  END_DATE_BLOCK_ID,
  END_TIME_ACTION_ID,
  END_TIME_BLOCK_ID,
  START_DATE_ACTION_ID,
  START_DATE_BLOCK_ID,
  START_TIME_ACTION_ID,
  START_TIME_BLOCK_ID,
  validateRequestTiming,
  type RequestTiming,
} from "./request-timing.ts";

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
        Record<
          string,
          {
            value?: string | null;
            selected_option?: { value?: string } | null;
            selected_user?: string | null;
            selected_date?: string | null;
            selected_time?: string | null;
          }
        >
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
  /** M8 correction: replaces the fixed duration dropdown — see request-timing.ts. Every field NULL unless the selected type's config actually collects timing (see request-type-config.ts). */
  timing: RequestTiming;
  /** Non-null only when the selected type's config marks it expense-bearing. */
  expense: RequestExpense;
  /**
   * The Slack user ID selected via the modal's native picker, or null when
   * the field wasn't shown/filled in. An identifier only, not an
   * authorization claim. M9: whether this is REQUIRED depends on whether
   * an active policy currently governs the submitted request type — DB
   * state this pure function has no access to — so that decision is made
   * by the caller (see the interactions route), not here. This function
   * only validates the field's FORMAT when present.
   */
  selectedApproverSlackId: string | null;
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
  return field?.selected_option?.value ?? field?.selected_user ?? field?.selected_date ?? field?.selected_time ?? field?.value ?? undefined;
}

function getOptionalFieldValue(payload: ViewSubmissionPayload, blockId: string, actionId: string): string | null {
  return getFieldValue(payload, blockId, actionId) ?? null;
}

const NO_TIMING: RequestTiming = { startDate: null, startTime: null, endDate: null, endTime: null };

/**
 * Validates a view_submission payload structurally and against business
 * rules. Does NOT touch the database — `validRequestTypeKeys` is passed in
 * by the caller (resolved fresh from the workspace's own request_types
 * rows), so this stays pure and unit-testable.
 *
 * M8 correction: which timing/expense fields are required, optional, or
 * outright rejected-if-present is entirely driven by
 * `getRequestTypeFieldConfig(requestTypeKey)` — the same shared config
 * build-request-modal.ts and the interactions route's dynamic-modal
 * handler read. Nothing here special-cases a request type by string
 * comparison outside that one lookup. Never trusts the modal to have hidden
 * an inapplicable field — a crafted/malformed submission carrying a field
 * that doesn't belong to the selected type's mode is rejected exactly like
 * a missing required one, not silently accepted or ignored.
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
  const isKnownType = Boolean(requestTypeKey) && validRequestTypeKeys.includes(requestTypeKey as string);
  if (!isKnownType) {
    errors.request_type_block = "Please select a valid request type.";
  }

  const resource = getFieldValue(payload, "resource_block", "resource_input")?.trim() ?? "";
  if (resource.length === 0) {
    errors.resource_block = "Details are required.";
  } else if (resource.length > MAX_DETAILS_LENGTH) {
    errors.resource_block = `Details must be ${MAX_DETAILS_LENGTH} characters or fewer.`;
  }

  const rawTiming: RequestTiming = {
    startDate: getOptionalFieldValue(payload, START_DATE_BLOCK_ID, START_DATE_ACTION_ID),
    startTime: getOptionalFieldValue(payload, START_TIME_BLOCK_ID, START_TIME_ACTION_ID),
    endDate: getOptionalFieldValue(payload, END_DATE_BLOCK_ID, END_DATE_ACTION_ID),
    endTime: getOptionalFieldValue(payload, END_TIME_BLOCK_ID, END_TIME_ACTION_ID),
  };
  const rawExpenseInput = {
    amount: getOptionalFieldValue(payload, EXPENSE_AMOUNT_BLOCK_ID, EXPENSE_AMOUNT_ACTION_ID),
    currency: getOptionalFieldValue(payload, EXPENSE_CURRENCY_BLOCK_ID, EXPENSE_CURRENCY_ACTION_ID),
  };

  let timing: RequestTiming = NO_TIMING;
  let expense: RequestExpense = { amount: null, currency: null };

  if (isKnownType) {
    const config = getRequestTypeFieldConfig(requestTypeKey as string);

    // --- Expense: required together only for an expense-mode type; rejected outright (never silently ignored) for every other type. ---
    if (config.expense) {
      const expenseResult = validateExpense(rawExpenseInput);
      if (!expenseResult.ok) {
        Object.assign(errors, expenseResult.errors);
      } else {
        expense = expenseResult.data;
      }
    } else if (rawExpenseInput.amount !== null || rawExpenseInput.currency !== null) {
      errors[EXPENSE_AMOUNT_BLOCK_ID] = "Amount/currency don't apply to this request type.";
    }

    // --- Timing: shape depends entirely on the type's configured mode. ---
    if (config.timingMode === "NONE") {
      if (rawTiming.startDate || rawTiming.startTime || rawTiming.endDate || rawTiming.endTime) {
        errors[START_DATE_BLOCK_ID] = "Timing doesn't apply to this request type.";
      }
    } else if (config.timingMode === "DATE_RANGE") {
      if (rawTiming.startTime !== null) {
        errors[START_TIME_BLOCK_ID] = "A specific time doesn't apply to this request type.";
      }
      if (rawTiming.endTime !== null) {
        errors[END_TIME_BLOCK_ID] = "A specific time doesn't apply to this request type.";
      }
      if (!rawTiming.startDate) {
        errors[START_DATE_BLOCK_ID] = "Start date is required.";
      }
      if (!rawTiming.endDate) {
        errors[END_DATE_BLOCK_ID] = "End date is required.";
      }
      timing = { startDate: rawTiming.startDate, startTime: null, endDate: rawTiming.endDate, endTime: null };
      if (rawTiming.startDate && rawTiming.endDate && !errors[START_TIME_BLOCK_ID] && !errors[END_TIME_BLOCK_ID]) {
        const timingResult = validateRequestTiming(timing);
        if (!timingResult.ok) {
          Object.assign(errors, timingResult.errors);
        }
      }
    } else if (config.timingMode === "SINGLE_DATE_TIME_RANGE") {
      // Conceptually one date, never a range: the employee picks it once
      // (block_id START_DATE_BLOCK_ID, labeled "Date" — see
      // build-request-modal.ts) and it's persisted as BOTH
      // requested_start_date and requested_end_date. A distinct end date
      // is never even rendered for this mode; if one is somehow present in
      // a crafted submission and disagrees with the single date, reject it
      // outright rather than silently using either value.
      if (rawTiming.endDate !== null && rawTiming.endDate !== rawTiming.startDate) {
        errors[END_DATE_BLOCK_ID] = "A separate end date doesn't apply to this request type.";
      }
      if (!rawTiming.startDate) {
        errors[START_DATE_BLOCK_ID] = "Date is required.";
      }
      if (!rawTiming.startTime) {
        errors[START_TIME_BLOCK_ID] = "Start time is required.";
      }
      if (!rawTiming.endTime) {
        errors[END_TIME_BLOCK_ID] = "End time is required.";
      }
      timing = { startDate: rawTiming.startDate, startTime: rawTiming.startTime, endDate: rawTiming.startDate, endTime: rawTiming.endTime };
      if (rawTiming.startDate && rawTiming.startTime && rawTiming.endTime && !errors[END_DATE_BLOCK_ID]) {
        const timingResult = validateRequestTiming(timing);
        if (!timingResult.ok) {
          Object.assign(errors, timingResult.errors);
        }
      }
    } else {
      // OPTIONAL_RANGE ("Other Request") — the full, independently-optional shape, unchanged from the general-purpose validator.
      const timingResult = validateRequestTiming(rawTiming);
      if (!timingResult.ok) {
        Object.assign(errors, timingResult.errors);
      }
      timing = rawTiming;
    }
  }
  // An unknown/invalid request type already fails via request_type_block above — timing/expense are left at their null defaults rather than guessing a mode for a type we couldn't resolve.

  // M9: the modal hides this field entirely when the selected type currently
  // has an active policy (see build-request-modal.ts), so its absence here
  // is expected and NOT an error at this layer — whether it's actually
  // required is a routing decision that depends on fresh, server-side
  // policy state this pure function has no access to (see the interactions
  // route's handleRequestSubmission, which re-checks the active policy and
  // rejects a submission that's missing an approver when routing truth
  // says DIRECT). When present, only its FORMAT is validated here — a
  // well-formed-but-ultimately-ignored value under POLICY routing is not
  // an error either; the interactions route decides whether to use it.
  const rawApproverSlackId = getFieldValue(payload, "approver_block", "approver_select");
  let selectedApproverSlackId: string | null = null;
  if (rawApproverSlackId) {
    if (!SLACK_USER_ID_PATTERN.test(rawApproverSlackId)) {
      errors.approver_block = "Please select a valid approver.";
    } else {
      selectedApproverSlackId = rawApproverSlackId;
    }
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
      timing,
      expense,
      selectedApproverSlackId,
    },
  };
}
