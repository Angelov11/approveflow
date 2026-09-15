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
