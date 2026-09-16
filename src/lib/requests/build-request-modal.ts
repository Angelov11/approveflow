import type { WebClient } from "@slack/web-api";

import { EXPENSE_AMOUNT_ACTION_ID, EXPENSE_AMOUNT_BLOCK_ID, EXPENSE_CURRENCY_ACTION_ID, EXPENSE_CURRENCY_BLOCK_ID, SUPPORTED_CURRENCIES } from "./expense.ts";
import { getRequestTypeFieldConfig } from "./request-type-config.ts";
import { END_DATE_ACTION_ID, END_DATE_BLOCK_ID, END_TIME_ACTION_ID, END_TIME_BLOCK_ID, START_DATE_ACTION_ID, START_DATE_BLOCK_ID, START_TIME_ACTION_ID, START_TIME_BLOCK_ID, type RequestTiming } from "./request-timing.ts";
import type { RequestType } from "../../types/request.ts";

/**
 * Derived from the installed @slack/web-api version's own `views.open`
 * argument type rather than importing `@slack/types` directly — that
 * package isn't a direct dependency of this repo (it's transitive via
 * @slack/web-api), and this keeps the modal shape guaranteed compatible
 * with whatever SDK version is actually installed.
 */
export type ModalView = Parameters<WebClient["views"]["open"]>[0]["view"];

export const REQUEST_MODAL_CALLBACK_ID = "approveflow_new_request";
export const REQUEST_TYPE_BLOCK_ID = "request_type_block";
export const REQUEST_TYPE_SELECT_ACTION_ID = "request_type_select";

const MAX_DETAILS_LENGTH = 200;

const DETAILS_PLACEHOLDERS: Readonly<Record<string, string>> = {
  vacation_time_off: "e.g. Family vacation",
  doctor_appointment: "e.g. Dentist appointment",
  work_from_home: "e.g. Working from home",
  personal_time: "e.g. Personal commitment",
  schedule_change: "e.g. Need to start later",
  expense_purchase: "e.g. External monitor",
  other: "Describe your request",
};
const DEFAULT_DETAILS_PLACEHOLDER = "e.g. Family vacation, dentist appointment, new monitor";

export interface PreservedRequestFields {
  resource?: string | null;
  approverSlackId?: string | null;
  timing?: RequestTiming;
  expense?: { amount: string | null; currency: string | null };
}

export interface BuildRequestModalParams {
  requestTypes: Pick<RequestType, "key" | "name">[];
  /** Correlates this specific opened view for idempotent submission handling (see src/app/api/slack/interactions). */
  idempotencyKey: string;
  /** Undefined/null on first open, before the requester has picked a type — the modal then shows only the universal fields. */
  selectedTypeKey?: string | null;
  /** Carried over from the previous render when the requester changes Request Type mid-modal (see request-type-config.ts's remap helpers) — never fabricated. */
  preserved?: PreservedRequestFields;
}

function sectionLabel(text: string): unknown {
  return { type: "context", elements: [{ type: "mrkdwn", text: `*${text}*` }] };
}

/**
 * M8 (corrected, request-type-aware): Request Type and Details always
 * appear; the WHEN section (date/time fields) and EXPENSE section
 * (amount/currency) are added or omitted per `getRequestTypeFieldConfig()`
 * — the same shared config the submission validator and the dynamic-modal
 * rebuild handler read, so the modal, the validation, and the input-
 * preservation logic can never disagree about which fields apply to which
 * request type. Selecting a different Request Type re-renders this modal
 * in place via `views.update` (see the interactions route) — this function
 * itself is stateless and pure; it only ever renders one snapshot.
 *
 * The Details field's block_id/action_id stay `resource_block`/
 * `resource_input` internally — it still maps directly to the `resource`
 * database column, which was never renamed. The Approver field no longer
 * explains policy routing to ordinary employees — that's an internal
 * implementation detail, not something the requester needs to know or act
 * on.
 */
export function buildRequestModal({ requestTypes, idempotencyKey, selectedTypeKey, preserved }: BuildRequestModalParams): ModalView {
  const config = selectedTypeKey ? getRequestTypeFieldConfig(selectedTypeKey) : null;
  const timing = preserved?.timing;
  const expense = preserved?.expense;

  const blocks: unknown[] = [
    sectionLabel("Request"),
    {
      type: "input",
      block_id: REQUEST_TYPE_BLOCK_ID,
      // Fires a block_actions payload the instant the selection changes
      // (in addition to being captured normally at final submission) — see
      // the interactions route's handleRequestTypeChanged for why this
      // click is UI state only, never authorization.
      dispatch_action: true,
      label: { type: "plain_text", text: "Request type" },
      element: {
        type: "static_select",
        action_id: REQUEST_TYPE_SELECT_ACTION_ID,
        placeholder: { type: "plain_text", text: "Select a request type" },
        options: requestTypes.map((requestType) => ({
          text: { type: "plain_text", text: requestType.name },
          value: requestType.key,
        })),
        ...(selectedTypeKey && requestTypes.some((t) => t.key === selectedTypeKey)
          ? { initial_option: { text: { type: "plain_text", text: requestTypes.find((t) => t.key === selectedTypeKey)!.name }, value: selectedTypeKey } }
          : {}),
      },
    },
    {
      type: "input",
      block_id: "resource_block",
      label: { type: "plain_text", text: "Details" },
      element: {
        type: "plain_text_input",
        action_id: "resource_input",
        max_length: MAX_DETAILS_LENGTH,
        placeholder: { type: "plain_text", text: (selectedTypeKey && DETAILS_PLACEHOLDERS[selectedTypeKey]) || DEFAULT_DETAILS_PLACEHOLDER },
        ...(preserved?.resource ? { initial_value: preserved.resource } : {}),
      },
    },
  ];

  if (config?.timingMode === "DATE_RANGE") {
    blocks.push(
      { type: "divider" },
      sectionLabel("When"),
      {
        type: "input",
        block_id: START_DATE_BLOCK_ID,
        label: { type: "plain_text", text: "Start date" },
        element: {
          type: "datepicker",
          action_id: START_DATE_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a date" },
          ...(timing?.startDate ? { initial_date: timing.startDate } : {}),
        },
      },
      {
        type: "input",
        block_id: END_DATE_BLOCK_ID,
        label: { type: "plain_text", text: "End date" },
        element: {
          type: "datepicker",
          action_id: END_DATE_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a date" },
          ...(timing?.endDate ? { initial_date: timing.endDate } : {}),
        },
      },
    );
  } else if (config?.timingMode === "SINGLE_DATE_TIME_RANGE") {
    blocks.push(
      { type: "divider" },
      sectionLabel("When"),
      {
        type: "input",
        block_id: START_DATE_BLOCK_ID,
        label: { type: "plain_text", text: "Date" },
        element: {
          type: "datepicker",
          action_id: START_DATE_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a date" },
          ...(timing?.startDate ? { initial_date: timing.startDate } : {}),
        },
      },
      {
        type: "input",
        block_id: START_TIME_BLOCK_ID,
        label: { type: "plain_text", text: "Start time" },
        element: {
          type: "timepicker",
          action_id: START_TIME_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a time" },
          ...(timing?.startTime ? { initial_time: timing.startTime } : {}),
        },
      },
      {
        type: "input",
        block_id: END_TIME_BLOCK_ID,
        label: { type: "plain_text", text: "End time" },
        element: {
          type: "timepicker",
          action_id: END_TIME_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a time" },
          ...(timing?.endTime ? { initial_time: timing.endTime } : {}),
        },
      },
    );
  } else if (config?.timingMode === "OPTIONAL_RANGE") {
    blocks.push(
      { type: "divider" },
      sectionLabel("When"),
      {
        type: "input",
        block_id: START_DATE_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Start date" },
        element: {
          type: "datepicker",
          action_id: START_DATE_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a date" },
          ...(timing?.startDate ? { initial_date: timing.startDate } : {}),
        },
      },
      {
        type: "input",
        block_id: START_TIME_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Start time" },
        element: {
          type: "timepicker",
          action_id: START_TIME_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a time" },
          ...(timing?.startTime ? { initial_time: timing.startTime } : {}),
        },
      },
      {
        type: "input",
        block_id: END_DATE_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "End date" },
        element: {
          type: "datepicker",
          action_id: END_DATE_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a date" },
          ...(timing?.endDate ? { initial_date: timing.endDate } : {}),
        },
      },
      {
        type: "input",
        block_id: END_TIME_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "End time" },
        element: {
          type: "timepicker",
          action_id: END_TIME_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a time" },
          ...(timing?.endTime ? { initial_time: timing.endTime } : {}),
        },
      },
    );
  }
  // timingMode NONE (Expense / Purchase), or no type selected yet: no WHEN section at all.

  if (config?.expense) {
    blocks.push(
      { type: "divider" },
      sectionLabel("Expense"),
      {
        type: "input",
        block_id: EXPENSE_AMOUNT_BLOCK_ID,
        label: { type: "plain_text", text: "Amount" },
        element: {
          type: "plain_text_input",
          action_id: EXPENSE_AMOUNT_ACTION_ID,
          placeholder: { type: "plain_text", text: "e.g. 499.99" },
          ...(expense?.amount ? { initial_value: expense.amount } : {}),
        },
      },
      {
        type: "input",
        block_id: EXPENSE_CURRENCY_BLOCK_ID,
        label: { type: "plain_text", text: "Currency" },
        element: {
          type: "static_select",
          action_id: EXPENSE_CURRENCY_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a currency" },
          options: SUPPORTED_CURRENCIES.map((code) => ({ text: { type: "plain_text", text: code }, value: code })),
          ...(expense?.currency && (SUPPORTED_CURRENCIES as readonly string[]).includes(expense.currency)
            ? { initial_option: { text: { type: "plain_text", text: expense.currency }, value: expense.currency } }
            : {}),
        },
      },
    );
  }

  blocks.push(
    { type: "divider" },
    sectionLabel("Approval"),
    {
      type: "input",
      block_id: "approver_block",
      label: { type: "plain_text", text: "Approver" },
      // Slack's native picker — no users:read scope needed, no API call
      // from this app to populate it.
      element: {
        type: "users_select",
        action_id: "approver_select",
        placeholder: { type: "plain_text", text: "Select an approver" },
        ...(preserved?.approverSlackId ? { initial_user: preserved.approverSlackId } : {}),
      },
    },
  );

  return {
    type: "modal",
    callback_id: REQUEST_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ idempotencyKey }),
    title: { type: "plain_text", text: "New Request" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  } as ModalView;
}
