import assert from "node:assert/strict";
import test from "node:test";

import { validatePaddleEnvironmentConfig } from "./paddle-environment-guard.ts";

test("sandbox + sandbox credentials are valid", () => {
  const result = validatePaddleEnvironmentConfig({
    environment: "sandbox",
    apiKey: "pdl_sdbx_apikey_abc123",
    clientToken: "test_abc123",
  });
  assert.deepEqual(result, { valid: true });
});

test("sandbox + live API key is rejected", () => {
  const result = validatePaddleEnvironmentConfig({
    environment: "sandbox",
    apiKey: "pdl_live_apikey_abc123",
    clientToken: "test_abc123",
  });
  assert.equal(result.valid, false);
});

test("sandbox + live client token is rejected", () => {
  const result = validatePaddleEnvironmentConfig({
    environment: "sandbox",
    apiKey: "pdl_sdbx_apikey_abc123",
    clientToken: "live_abc123",
  });
  assert.equal(result.valid, false);
});

test("live + live credentials are valid", () => {
  const result = validatePaddleEnvironmentConfig({
    environment: "live",
    apiKey: "pdl_live_apikey_abc123",
    clientToken: "live_abc123",
  });
  assert.deepEqual(result, { valid: true });
});

test("live + sandbox API key is rejected", () => {
  const result = validatePaddleEnvironmentConfig({
    environment: "live",
    apiKey: "pdl_sdbx_apikey_abc123",
    clientToken: "live_abc123",
  });
  assert.equal(result.valid, false);
});

test("live + sandbox client token is rejected", () => {
  const result = validatePaddleEnvironmentConfig({
    environment: "live",
    apiKey: "pdl_live_apikey_abc123",
    clientToken: "test_abc123",
  });
  assert.equal(result.valid, false);
});

test("missing PADDLE_ENVIRONMENT is rejected", () => {
  const result = validatePaddleEnvironmentConfig({ environment: undefined, apiKey: "pdl_sdbx_apikey_abc123", clientToken: "test_abc123" });
  assert.equal(result.valid, false);
});

test("missing PADDLE_API_KEY is rejected", () => {
  const result = validatePaddleEnvironmentConfig({ environment: "sandbox", apiKey: undefined, clientToken: "test_abc123" });
  assert.equal(result.valid, false);
});

test("missing NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is rejected", () => {
  const result = validatePaddleEnvironmentConfig({ environment: "sandbox", apiKey: "pdl_sdbx_apikey_abc123", clientToken: undefined });
  assert.equal(result.valid, false);
});

test("garbage-prefixed API key is rejected even when environment matches", () => {
  const result = validatePaddleEnvironmentConfig({ environment: "sandbox", apiKey: "not_a_real_key", clientToken: "test_abc123" });
  assert.equal(result.valid, false);
});
