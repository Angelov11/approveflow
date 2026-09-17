import assert from "node:assert/strict";
import test from "node:test";

import { buildAddAdministratorModal, buildAdminErrorView, buildManageAdministratorsView } from "./build-admin-views.ts";

interface PlainModalView {
  blocks?: unknown[];
  submit?: { text: string };
  callback_id?: string;
}

function blocksToText(view: { blocks?: unknown[] }): string {
  return JSON.stringify(view.blocks);
}

function asPlain(view: unknown): PlainModalView {
  return view as PlainModalView;
}

test("lists each admin as a Slack mention with a Remove button", () => {
  const view = buildManageAdministratorsView([{ slackUserId: "U0GARY123" }, { slackUserId: "U0IVAN456" }]);
  const text = blocksToText(view);
  assert.ok(text.includes("<@U0GARY123>"));
  assert.ok(text.includes("<@U0IVAN456>"));
  // Each row has two "Remove" occurrences: the accessory button itself and
  // its confirm dialog's own confirm button — two admins -> four total.
  assert.equal((text.match(/"text":"Remove"/g) ?? []).length, 4);
});

test("Remove has a native confirm dialog, never a substitute for server-side reauthorization", () => {
  const view = buildManageAdministratorsView([{ slackUserId: "U0GARY123" }]);
  const text = blocksToText(view);
  assert.ok(text.includes("confirm"));
  assert.ok(text.includes("Remove administrator?"));
});

test("includes an Add Administrator button", () => {
  const view = buildManageAdministratorsView([{ slackUserId: "U0GARY123" }]);
  assert.ok(blocksToText(view).includes("Add Administrator"));
});

test("an optional banner is rendered above the admin list when provided", () => {
  const withBanner = buildManageAdministratorsView([{ slackUserId: "U0GARY123" }], "The last administrator can't be removed.");
  const withoutBanner = buildManageAdministratorsView([{ slackUserId: "U0GARY123" }]);
  assert.ok(blocksToText(withBanner).includes("The last administrator can't be removed."));
  assert.ok(!blocksToText(withoutBanner).includes("last administrator can't be removed"));
});

test("has no submit/callback_id — every mutation happens via block_actions, not view_submission", () => {
  const view = asPlain(buildManageAdministratorsView([{ slackUserId: "U0GARY123" }]));
  assert.equal(view.submit, undefined);
  assert.equal(view.callback_id, undefined);
});

test("Add Administrator modal has a single required users_select and a real callback_id", () => {
  const view = buildAddAdministratorModal();
  const text = blocksToText(view);
  assert.ok(text.includes("users_select"));
  assert.equal(asPlain(view).callback_id, "approveflow_add_administrator");
});

test("buildAdminErrorView renders the given message in a closable modal", () => {
  const view = buildAdminErrorView("Something went wrong.");
  assert.ok(blocksToText(view).includes("Something went wrong."));
});
