import assert from "node:assert/strict";
import test from "node:test";

import { isBotAdminCandidate } from "./is-bot-admin-candidate.ts";

test("the workspace's own bot user is rejected as an admin candidate", () => {
  assert.equal(isBotAdminCandidate("UBOT1", "UBOT1"), true);
});

test("an ordinary human Slack user is not a bot admin candidate", () => {
  assert.equal(isBotAdminCandidate("UHUMAN1", "UBOT1"), false);
});

test("a null workspace bot_user_id never matches — never a false positive from a missing bot id", () => {
  assert.equal(isBotAdminCandidate("UANY", null), false);
});
