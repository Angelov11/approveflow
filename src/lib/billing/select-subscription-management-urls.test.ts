import assert from "node:assert/strict";
import test from "node:test";

import { selectSubscriptionManagementUrls, type PortalSubscriptionUrlEntry } from "./select-subscription-management-urls.ts";

const TARGET = "sub_target";
const OTHER = "sub_other";

function entry(id: string, overrides: Partial<PortalSubscriptionUrlEntry> = {}): PortalSubscriptionUrlEntry {
  return {
    id,
    cancelSubscription: `https://paddle.example/cancel/${id}`,
    updateSubscriptionPaymentMethod: `https://paddle.example/update/${id}`,
    ...overrides,
  };
}

test("selects the entry matching the target id by exact id, not array position", () => {
  // The target is NOT the first element — proves selection is by id, never [0].
  const urls = [entry(OTHER), entry(TARGET)];
  const result = selectSubscriptionManagementUrls(urls, TARGET);
  assert.deepEqual(result, {
    updatePaymentMethod: `https://paddle.example/update/${TARGET}`,
    cancelSubscription: `https://paddle.example/cancel/${TARGET}`,
  });
});

test("a URL belonging to a different subscription is never returned", () => {
  const urls = [entry(OTHER)];
  const result = selectSubscriptionManagementUrls(urls, TARGET);
  assert.equal(result, null);
});

test("no matching entry at all -> controlled null, not a guess", () => {
  const result = selectSubscriptionManagementUrls([], TARGET);
  assert.equal(result, null);
});

test("matching entry but missing cancelSubscription -> controlled null for the whole result", () => {
  const urls = [entry(TARGET, { cancelSubscription: "" })];
  const result = selectSubscriptionManagementUrls(urls, TARGET);
  assert.equal(result, null);
});

test("matching entry but missing updateSubscriptionPaymentMethod -> controlled null for the whole result", () => {
  const urls = [entry(TARGET, { updateSubscriptionPaymentMethod: "" })];
  const result = selectSubscriptionManagementUrls(urls, TARGET);
  assert.equal(result, null);
});

test("never falls back to another entry when the target is missing/incomplete", () => {
  const urls = [entry(OTHER), entry(TARGET, { cancelSubscription: "" })];
  const result = selectSubscriptionManagementUrls(urls, TARGET);
  assert.equal(result, null);
});
