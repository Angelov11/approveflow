import assert from "node:assert/strict";
import test from "node:test";

import { deriveBillingSessionSecret } from "./billing-session-secret.ts";
import { createBillingSessionToken, verifyBillingSessionToken } from "./billing-session-token.ts";
import { deriveOAuthStateSecret } from "../slack/state-secret.ts";

const CLIENT_SECRET = "test-slack-client-secret";
const SECRET = deriveBillingSessionSecret(CLIENT_SECRET);
const WORKSPACE_ID = "c94923d9-cc5b-451c-bffe-8501a36a4eeb";
const NOW = 1_800_000_000;

test("a freshly created checkout token verifies successfully for checkout", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW });
  const result = verifyBillingSessionToken(token, "checkout", SECRET, NOW);
  assert.deepEqual(result, { valid: true, workspaceId: WORKSPACE_ID });
});

test("a freshly created manage_billing token verifies successfully for manage_billing", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "manage_billing", secret: SECRET, nowSeconds: NOW });
  const result = verifyBillingSessionToken(token, "manage_billing", SECRET, NOW);
  assert.deepEqual(result, { valid: true, workspaceId: WORKSPACE_ID });
});

test("a checkout token is rejected when verified against manage_billing", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW });
  const result = verifyBillingSessionToken(token, "manage_billing", SECRET, NOW);
  assert.deepEqual(result, { valid: false, reason: "wrong_purpose" });
});

test("a manage_billing token is rejected when verified against checkout", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "manage_billing", secret: SECRET, nowSeconds: NOW });
  const result = verifyBillingSessionToken(token, "checkout", SECRET, NOW);
  assert.deepEqual(result, { valid: false, reason: "wrong_purpose" });
});

test("a token is still valid one second before expiry", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW, ttlSeconds: 900 });
  const result = verifyBillingSessionToken(token, "checkout", SECRET, NOW + 899);
  assert.equal(result.valid, true);
});

test("an expired token is rejected", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW, ttlSeconds: 900 });
  const result = verifyBillingSessionToken(token, "checkout", SECRET, NOW + 901);
  assert.deepEqual(result, { valid: false, reason: "expired" });
});

test("an expired token of the wrong purpose is still rejected (wrong_purpose is checked before expiry, but either way it's rejected)", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW, ttlSeconds: 900 });
  const result = verifyBillingSessionToken(token, "manage_billing", SECRET, NOW + 901);
  assert.equal(result.valid, false);
});

test("a tampered payload (different workspaceId) is rejected", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW });
  const [encodedPayload, signature] = token.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ workspaceId: "attacker-controlled-workspace", purpose: "checkout", exp: NOW + 900 }),
    "utf8",
  ).toString("base64url");
  const tampered = `${forgedPayload}.${signature}`;
  const result = verifyBillingSessionToken(tampered, "checkout", SECRET, NOW);
  assert.deepEqual(result, { valid: false, reason: "tampered" });
  assert.notEqual(encodedPayload, forgedPayload);
});

test("a tampered payload attempting to escalate purpose (checkout -> manage_billing) is rejected by the signature check, never reaching the purpose check", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW });
  const [, signature] = token.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ workspaceId: WORKSPACE_ID, purpose: "manage_billing", exp: NOW + 900 }), "utf8").toString(
    "base64url",
  );
  const tampered = `${forgedPayload}.${signature}`;
  const result = verifyBillingSessionToken(tampered, "manage_billing", SECRET, NOW);
  assert.deepEqual(result, { valid: false, reason: "tampered" });
});

test("a tampered signature is rejected", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW });
  const [encodedPayload] = token.split(".");
  const tampered = `${encodedPayload}.${"0".repeat(64)}`;
  const result = verifyBillingSessionToken(tampered, "checkout", SECRET, NOW);
  assert.deepEqual(result, { valid: false, reason: "tampered" });
});

test("a malformed token (no separator) is rejected", () => {
  const result = verifyBillingSessionToken("not-a-valid-token", "checkout", SECRET, NOW);
  assert.deepEqual(result, { valid: false, reason: "malformed" });
});

test("a malformed token (garbage payload segment) is rejected", () => {
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: SECRET, nowSeconds: NOW });
  const [, signature] = token.split(".");
  const result = verifyBillingSessionToken(`not-base64.${signature}`, "checkout", SECRET, NOW);
  assert.equal(result.valid, false);
});

test("a token signed for a different purpose/domain secret cannot validate as a billing session at all", () => {
  const wrongDomainSecret = deriveOAuthStateSecret(CLIENT_SECRET);
  const token = createBillingSessionToken({ workspaceId: WORKSPACE_ID, purpose: "checkout", secret: wrongDomainSecret, nowSeconds: NOW });
  const result = verifyBillingSessionToken(token, "checkout", SECRET, NOW);
  assert.deepEqual(result, { valid: false, reason: "tampered" });
});
