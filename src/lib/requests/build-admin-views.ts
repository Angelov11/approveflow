import type { WebClient } from "@slack/web-api";

/** Derived from the installed @slack/web-api version's own `views.open` argument type — see build-request-modal.ts for why. */
export type ModalView = Parameters<WebClient["views"]["open"]>[0]["view"];

export const MANAGE_ADMINISTRATORS_ACTION_ID = "manage_administrators";
export const MANAGE_POLICIES_ACTION_ID = "manage_approval_policies";
export const ADD_ADMINISTRATOR_ACTION_ID = "add_administrator";
export const REMOVE_ADMINISTRATOR_ACTION_ID = "remove_administrator";
export const CONFIGURE_POLICY_ACTION_ID = "configure_policy";

export const ADD_ADMINISTRATOR_CALLBACK_ID = "approveflow_add_administrator";
export const ADD_ADMINISTRATOR_BLOCK_ID = "add_administrator_block";
export const ADD_ADMINISTRATOR_SELECT_ACTION_ID = "add_administrator_select";

export interface AdminRow {
  slackUserId: string;
}

/**
 * "Manage Administrators" — lists current admins as `<@id>` mentions (Slack
 * resolves the display name client-side; no name storage/lookup needed)
 * with a per-row Remove button, plus an Add Administrator button. Never a
 * `view_submission` target itself — every mutation happens via
 * `block_actions` clicks inside it, each followed by a `views.update` that
 * rebuilds this same view from fresh server-side state (never trusting
 * whatever this view previously displayed).
 *
 * Slack's native `confirm` on the Remove button is a cosmetic UX nicety
 * only — it is NEVER a substitute for the server-side reauthorization and
 * atomic last-admin check that happen when the click is actually handled
 * (see remove_workspace_admin() / isWorkspaceAdmin()).
 */
export function buildManageAdministratorsView(admins: AdminRow[], banner?: string): ModalView {
  const blocks: unknown[] = [];
  if (banner) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `_${banner}_` } }, { type: "divider" });
  }
  blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Current administrators*" } });

  for (const admin of admins) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `<@${admin.slackUserId}>` },
      accessory: {
        type: "button",
        action_id: REMOVE_ADMINISTRATOR_ACTION_ID,
        text: { type: "plain_text", text: "Remove" },
        style: "danger",
        value: admin.slackUserId,
        confirm: {
          title: { type: "plain_text", text: "Remove administrator?" },
          text: { type: "mrkdwn", text: `Remove <@${admin.slackUserId}> as an ApproveFlow administrator? This can't be the last administrator.` },
          confirm: { type: "plain_text", text: "Remove" },
          deny: { type: "plain_text", text: "Cancel" },
        },
      },
    });
  }

  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      block_id: "manage_administrators_actions",
      elements: [{ type: "button", action_id: ADD_ADMINISTRATOR_ACTION_ID, style: "primary", text: { type: "plain_text", text: "Add Administrator" } }],
    },
  );

  return {
    type: "modal",
    title: { type: "plain_text", text: "Administrators" },
    close: { type: "plain_text", text: "Done" },
    blocks,
  } as ModalView;
}

/** Pushed on top of "Manage Administrators" — a single users_select, submitted via view_submission. */
export function buildAddAdministratorModal(): ModalView {
  return {
    type: "modal",
    callback_id: ADD_ADMINISTRATOR_CALLBACK_ID,
    title: { type: "plain_text", text: "Add Administrator" },
    submit: { type: "plain_text", text: "Add" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: ADD_ADMINISTRATOR_BLOCK_ID,
        label: { type: "plain_text", text: "Slack user" },
        element: {
          type: "users_select",
          action_id: ADD_ADMINISTRATOR_SELECT_ACTION_ID,
          placeholder: { type: "plain_text", text: "Select a person" },
        },
      },
    ],
  } as ModalView;
}

export function buildAdminErrorView(message: string): ModalView {
  return {
    type: "modal",
    title: { type: "plain_text", text: "ApproveFlow" },
    close: { type: "plain_text", text: "Close" },
    blocks: [{ type: "section", text: { type: "mrkdwn", text: message } }],
  } as ModalView;
}
