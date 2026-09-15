import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { isValidSlackRequest } from "./verify-request.ts";

const signingSecret = "test-signing-secret";
const rawBody = "command=%2Frequest&team_id=T123&user_id=U123";
const nowSeconds = 1_700_000_000;

function sign(timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

test("valid signature is accepted", () => {
  const timestamp = String(nowSeconds);
  const signature = sign(timestamp, rawBody);
  assert.equal(isValidSlackRequest({ signingSecret, rawBody, timestamp, signature, nowSeconds }), true);
});

test("invalid signature is rejected", () => {
  const timestamp = String(nowSeconds);
  const signature = sign(timestamp, "a different body");
  assert.equal(isValidSlackRequest({ signingSecret, rawBody, timestamp, signature, nowSeconds }), false);
});

test("missing signature is rejected", () => {
  const timestamp = String(nowSeconds);
  assert.equal(isValidSlackRequest({ signingSecret, rawBody, timestamp, signature: null, nowSeconds }), false);
});

test("missing timestamp is rejected", () => {
  const signature = sign(String(nowSeconds), rawBody);
  assert.equal(isValidSlackRequest({ signingSecret, rawBody, timestamp: null, signature, nowSeconds }), false);
});

test("stale timestamp is rejected", () => {
  const staleTimestamp = String(nowSeconds - 60 * 10);
  const signature = sign(staleTimestamp, rawBody);
  assert.equal(
    isValidSlackRequest({ signingSecret, rawBody, timestamp: staleTimestamp, signature, nowSeconds }),
    false,
  );
});

test("future timestamp beyond tolerance is rejected", () => {
  const futureTimestamp = String(nowSeconds + 60 * 10);
  const signature = sign(futureTimestamp, rawBody);
  assert.equal(
    isValidSlackRequest({ signingSecret, rawBody, timestamp: futureTimestamp, signature, nowSeconds }),
    false,
  );
});

test("tampered body is rejected", () => {
  const timestamp = String(nowSeconds);
  const signature = sign(timestamp, rawBody);
  const tamperedBody = `${rawBody}&extra=1`;
  assert.equal(
    isValidSlackRequest({ signingSecret, rawBody: tamperedBody, timestamp, signature, nowSeconds }),
    false,
  );
});

test("malformed signature is rejected safely (no throw)", () => {
  const timestamp = String(nowSeconds);
  assert.doesNotThrow(() => {
    assert.equal(
      isValidSlackRequest({ signingSecret, rawBody, timestamp, signature: "not-a-signature", nowSeconds }),
      false,
    );
  });
});

test("non-numeric timestamp is rejected safely (no throw)", () => {
  const signature = sign("not-a-number", rawBody);
  assert.doesNotThrow(() => {
    assert.equal(
      isValidSlackRequest({ signingSecret, rawBody, timestamp: "not-a-number", signature, nowSeconds }),
      false,
    );
  });
});

test("wrong signing secret is rejected", () => {
  const timestamp = String(nowSeconds);
  const signature = sign(timestamp, rawBody);
  assert.equal(
    isValidSlackRequest({ signingSecret: "a-different-secret", rawBody, timestamp, signature, nowSeconds }),
    false,
  );
});
