import type { WebClient } from "@slack/web-api";

import { END_DATE_ACTION_ID, END_DATE_BLOCK_ID, END_TIME_ACTION_ID, END_TIME_BLOCK_ID, START_DATE_ACTION_ID, START_DATE_BLOCK_ID, START_TIME_ACTION_ID, START_TIME_BLOCK_ID } from "./request-timing.ts";
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

const MAX_DETAILS_LENGTH = 200;

export interface BuildRequestModalParams {
  requestTypes: Pick<RequestType, "key" | "name">[];
  /** Correlates this specific opened view for idempotent submission handling (see src/app/api/slack/interactions). */
  idempotencyKey: string;
}

/**
 * M8 (corrected): Request Type / Details / Start date / Start time / End
 * date / End time / Approver. The original "Reason" field was dropped as
 * redundant with "Details" for everyday workplace requests. The original
 * fixed "Duration" dropdown (30 minutes .. 1 week) was replaced by native
 * Slack `datepicker`/`timepicker` elements — a dropdown could say "1 week"
 * but never which week; a requester can now say exactly which dates. All
 * four are independently optional (`optional: true` on each input block) —
 * see validate-request-submission.ts/request-timing.ts for how a partial
 * combination is validated. The Details field's block_id/action_id stay
 * `resource_block`/`resource_input` internally — it still maps directly to
 * the `resource` database column, which was never renamed; only the
 * visible label changed. The Approver field no longer explains policy
 * routing to ordinary employees — that's an internal implementation detail
 * (see the interactions route for how POLICY vs. DIRECT is actually
 * resolved), not something the requester needs to know or act on.
 */
export function buildRequestModal({ requestTypes, idempotencyKey }: BuildRequestModalParams): ModalView {
  return {
    type: "modal",
    callback_id: REQUEST_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ idempotencyKey }),
    title: { type: "plain_text", text: "New Request" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "request_type_block",
        label: { type: "plain_text", text: "Request type" },
        element: {
          type: "static_select",
          action_id: "request_type_select",
          placeholder: { type: "plain_text", text: "Select a request type" },
          options: requestTypes.map((requestType) => ({
            text: { type: "plain_text", text: requestType.name },
            value: requestType.key,
          })),
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
          placeholder: { type: "plain_text", text: "e.g. Family vacation, dentist appointment, new monitor" },
        },
      },
      {
        type: "input",
        block_id: START_DATE_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Start date" },
        element: { type: "datepicker", action_id: START_DATE_ACTION_ID, placeholder: { type: "plain_text", text: "Select a date" } },
      },
      {
        type: "input",
        block_id: START_TIME_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Start time" },
        element: { type: "timepicker", action_id: START_TIME_ACTION_ID, placeholder: { type: "plain_text", text: "Select a time" } },
      },
      {
        type: "input",
        block_id: END_DATE_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "End date" },
        element: { type: "datepicker", action_id: END_DATE_ACTION_ID, placeholder: { type: "plain_text", text: "Select a date" } },
      },
      {
        type: "input",
        block_id: END_TIME_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "End time" },
        element: { type: "timepicker", action_id: END_TIME_ACTION_ID, placeholder: { type: "plain_text", text: "Select a time" } },
      },
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
        },
      },
    ],
  } as ModalView;
}
