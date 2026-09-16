import assert from "node:assert/strict";
import test from "node:test";
import { parseSlackEvent } from "./parse-slack-event.ts";

test("a valid url_verification envelope returns its challenge", () => {
  const result = parseSlackEvent({ type: "url_verification", challenge: "abc123" });
  assert.deepEqual(result, { kind: "url_verification", challenge: "abc123" });
});

test("url_verification missing a challenge is ignored, not thrown", () => {
  const result = parseSlackEvent({ type: "url_verification" });
  assert.deepEqual(result, { kind: "ignored" });
});

test("app_home_opened on the home tab is accepted with team/user ids", () => {
  const result = parseSlackEvent({
    type: "event_callback",
    team_id: "T123",
    event: { type: "app_home_opened", user: "U123", tab: "home" },
  });
  assert.deepEqual(result, { kind: "app_home_opened", slackTeamId: "T123", slackUserId: "U123" });
});

test("app_home_opened on the messages tab is ignored (never republish Home for it)", () => {
  const result = parseSlackEvent({
    type: "event_callback",
    team_id: "T123",
    event: { type: "app_home_opened", user: "U123", tab: "messages" },
  });
  assert.deepEqual(result, { kind: "ignored" });
});

test("an unsupported event type is safely ignored", () => {
  const result = parseSlackEvent({
    type: "event_callback",
    team_id: "T123",
    event: { type: "message", user: "U123" },
  });
  assert.deepEqual(result, { kind: "ignored" });
});

test("an unknown top-level envelope type is safely ignored", () => {
  const result = parseSlackEvent({ type: "something_else" });
  assert.deepEqual(result, { kind: "ignored" });
});

test("event_callback missing team_id is safely ignored", () => {
  const result = parseSlackEvent({
    type: "event_callback",
    event: { type: "app_home_opened", user: "U123", tab: "home" },
  });
  assert.deepEqual(result, { kind: "ignored" });
});

test("event_callback missing event.user is safely ignored", () => {
  const result = parseSlackEvent({
    type: "event_callback",
    team_id: "T123",
    event: { type: "app_home_opened", tab: "home" },
  });
  assert.deepEqual(result, { kind: "ignored" });
});

test("a completely empty envelope is safely ignored, never throws", () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(parseSlackEvent({}), { kind: "ignored" });
  });
});

// --- M8.1: app_uninstalled ---

test("app_uninstalled is accepted with the team id", () => {
  const result = parseSlackEvent({ type: "event_callback", team_id: "T123", event: { type: "app_uninstalled" } });
  assert.deepEqual(result, { kind: "app_uninstalled", slackTeamId: "T123" });
});

test("app_uninstalled missing team_id is safely ignored", () => {
  const result = parseSlackEvent({ type: "event_callback", event: { type: "app_uninstalled" } });
  assert.deepEqual(result, { kind: "ignored" });
});

// --- M8.1: tokens_revoked ---

test("tokens_revoked is accepted with the team id and the revoked bot user ids", () => {
  const result = parseSlackEvent({
    type: "event_callback",
    team_id: "T123",
    event: { type: "tokens_revoked", tokens: { bot: ["U_BOT_1"], oauth: ["U_USER_1"] } },
  });
  assert.deepEqual(result, { kind: "tokens_revoked", slackTeamId: "T123", revokedBotUserIds: ["U_BOT_1"] });
});

test("tokens_revoked with no bot tokens in the payload still parses, with an empty revokedBotUserIds list", () => {
  const result = parseSlackEvent({
    type: "event_callback",
    team_id: "T123",
    event: { type: "tokens_revoked", tokens: { oauth: ["U_USER_1"] } },
  });
  assert.deepEqual(result, { kind: "tokens_revoked", slackTeamId: "T123", revokedBotUserIds: [] });
});

test("tokens_revoked with a malformed tokens.bot value never throws and treats it as empty", () => {
  const result = parseSlackEvent({
    type: "event_callback",
    team_id: "T123",
    // @ts-expect-error deliberately malformed to prove this never throws
    event: { type: "tokens_revoked", tokens: { bot: "not-an-array" } },
  });
  assert.deepEqual(result, { kind: "tokens_revoked", slackTeamId: "T123", revokedBotUserIds: [] });
});

test("tokens_revoked missing team_id is safely ignored", () => {
  const result = parseSlackEvent({ type: "event_callback", event: { type: "tokens_revoked", tokens: { bot: ["U_BOT_1"] } } });
  assert.deepEqual(result, { kind: "ignored" });
});
