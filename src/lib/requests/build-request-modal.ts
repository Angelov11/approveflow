import type { WebClient } from "@slack/web-api";

import { DURATION_OPTIONS } from "@/lib/requests/duration-options";
import type { RequestType } from "@/types/request";

/**
 * Derived from the installed @slack/web-api version's own `views.open`
 * argument type rather than importing `@slack/types` directly — that
 * package isn't a direct dependency of this repo (it's transitive via
 * @slack/web-api), and this keeps the modal shape guaranteed compatible
 * with whatever SDK version is actually installed.
 */
export type ModalView = Parameters<WebClient["views"]["open"]>[0]["view"];

export const REQUEST_MODAL_CALLBACK_ID = "approveflow_new_request";

const MAX_RESOURCE_LENGTH = 200;
const MAX_REASON_LENGTH = 2000;

export interface BuildRequestModalParams {
  requestTypes: Pick<RequestType, "key" | "name">[];
  /** Correlates this specific opened view for idempotent submission handling (see src/app/api/slack/interactions). */
  idempotencyKey: string;
}

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
        label: { type: "plain_text", text: "Resource" },
        element: {
          type: "plain_text_input",
          action_id: "resource_input",
          max_length: MAX_RESOURCE_LENGTH,
          placeholder: { type: "plain_text", text: "e.g. AWS Production" },
        },
      },
      {
        type: "input",
        block_id: "reason_block",
        label: { type: "plain_text", text: "Reason" },
        element: {
          type: "plain_text_input",
          action_id: "reason_input",
          multiline: true,
          max_length: MAX_REASON_LENGTH,
        },
      },
      {
        type: "input",
        block_id: "duration_block",
        label: { type: "plain_text", text: "Duration" },
        element: {
          type: "static_select",
          action_id: "duration_select",
          placeholder: { type: "plain_text", text: "Select a duration" },
          options: DURATION_OPTIONS.map((option) => ({
            text: { type: "plain_text", text: option.label },
            value: option.value,
          })),
        },
      },
      {
        type: "input",
        block_id: "approver_block",
        label: { type: "plain_text", text: "Approver" },
        // Slack's native picker — no users:read scope needed, no API call
        // from this app to populate it. Shown for every request type
        // (no dynamic modal behavior in M4); the hint clarifies it's only
        // acted on when no approval policy governs the selected type.
        hint: { type: "plain_text", text: "Used when no approval policy is configured for this request type." },
        element: {
          type: "users_select",
          action_id: "approver_select",
          placeholder: { type: "plain_text", text: "Select an approver" },
        },
      },
    ],
  } as ModalView;
}
