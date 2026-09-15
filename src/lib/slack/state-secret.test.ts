import assert from "node:assert/strict";
import test from "node:test";
import { deriveOAuthStateSecret } from "./state-secret.ts";

test("derivation is deterministic for the same input", () => {
  assert.equal(deriveOAuthStateSecret("client-secret-a"), deriveOAuthStateSecret("client-secret-a"));
});

test("different client secrets derive different state secrets", () => {
  assert.notEqual(deriveOAuthStateSecret("client-secret-a"), deriveOAuthStateSecret("client-secret-b"));
});

test("derived secret is not the raw client secret", () => {
  assert.notEqual(deriveOAuthStateSecret("client-secret-a"), "client-secret-a");
});
