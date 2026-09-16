import assert from "node:assert/strict";
import test from "node:test";

import { isUsableInstallation } from "./installation-usability.ts";
import type { Workspace } from "../../types/workspace.ts";

const BASE: Workspace = {
  id: "11111111-1111-1111-1111-111111111111",
  slack_team_id: "T123",
  slack_enterprise_id: null,
  slack_app_id: null,
  name: "Acme",
  domain: null,
  bot_user_id: "UBOT1",
  bot_access_token_ciphertext: "cipher",
  bot_access_token_iv: "iv",
  bot_access_token_auth_tag: "tag",
  installation_status: "INSTALLED",
  uninstalled_at: null,
  installed_at: "2026-09-15T00:00:00.000Z",
  created_at: "2026-09-15T00:00:00.000Z",
  updated_at: "2026-09-15T00:00:00.000Z",
};

test("INSTALLED with a complete token is usable", () => {
  assert.equal(isUsableInstallation(BASE), true);
});

test("null (unknown workspace) is unusable", () => {
  assert.equal(isUsableInstallation(null), false);
});

test("TOKEN_REVOKED is unusable even if token columns happen to still hold a value", () => {
  assert.equal(isUsableInstallation({ ...BASE, installation_status: "TOKEN_REVOKED" }), false);
});

test("UNINSTALLED is unusable", () => {
  assert.equal(isUsableInstallation({ ...BASE, installation_status: "UNINSTALLED", uninstalled_at: "2026-09-16T00:00:00.000Z" }), false);
});

test("INSTALLED with a missing ciphertext is unusable — fails closed on a partial token row", () => {
  assert.equal(isUsableInstallation({ ...BASE, bot_access_token_ciphertext: null }), false);
});

test("INSTALLED with a missing iv is unusable", () => {
  assert.equal(isUsableInstallation({ ...BASE, bot_access_token_iv: null }), false);
});

test("INSTALLED with a missing auth tag is unusable", () => {
  assert.equal(isUsableInstallation({ ...BASE, bot_access_token_auth_tag: null }), false);
});

test("acts as a type guard narrowing to UsableWorkspace", () => {
  const workspace: Workspace = BASE;
  if (isUsableInstallation(workspace)) {
    // Compiles only if the guard narrowed the nullable token fields to string.
    const ciphertext: string = workspace.bot_access_token_ciphertext;
    assert.equal(ciphertext, "cipher");
  } else {
    assert.fail("expected BASE to be usable");
  }
});
