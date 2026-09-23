import assert from "node:assert/strict";
import test from "node:test";

import { resolveSubscriptionManagementUrls, type PortalSessionResult } from "./resolve-subscription-management-urls.ts";
import type { PortalSubscriptionUrlEntry } from "./select-subscription-management-urls.ts";

const CUSTOMER_ID = "ctm_target";
const SUBSCRIPTION_ID = "sub_target";

function fakePortalSession(capture: { customerId?: string; subscriptionIds?: string[] }, subscriptions: PortalSubscriptionUrlEntry[]) {
  return async (customerId: string, subscriptionIds: string[]): Promise<PortalSessionResult> => {
    capture.customerId = customerId;
    capture.subscriptionIds = subscriptionIds;
    return { urls: { subscriptions } };
  };
}

test("creates the portal session with the exact provider_customer_id", async () => {
  const capture: { customerId?: string; subscriptionIds?: string[] } = {};
  await resolveSubscriptionManagementUrls(
    CUSTOMER_ID,
    SUBSCRIPTION_ID,
    fakePortalSession(capture, [{ id: SUBSCRIPTION_ID, cancelSubscription: "https://cancel", updateSubscriptionPaymentMethod: "https://update" }]),
  );
  assert.equal(capture.customerId, CUSTOMER_ID);
});

test("creates the portal session scoped to exactly the provider_subscription_id, as a single-element list", async () => {
  const capture: { customerId?: string; subscriptionIds?: string[] } = {};
  await resolveSubscriptionManagementUrls(
    CUSTOMER_ID,
    SUBSCRIPTION_ID,
    fakePortalSession(capture, [{ id: SUBSCRIPTION_ID, cancelSubscription: "https://cancel", updateSubscriptionPaymentMethod: "https://update" }]),
  );
  assert.deepEqual(capture.subscriptionIds, [SUBSCRIPTION_ID]);
});

test("returns the matching subscription's specific URLs, selected by id rather than array position", async () => {
  const result = await resolveSubscriptionManagementUrls(
    CUSTOMER_ID,
    SUBSCRIPTION_ID,
    fakePortalSession({}, [
      { id: "sub_other_workspace", cancelSubscription: "https://cancel-other", updateSubscriptionPaymentMethod: "https://update-other" },
      { id: SUBSCRIPTION_ID, cancelSubscription: "https://cancel-target", updateSubscriptionPaymentMethod: "https://update-target" },
    ]),
  );
  assert.deepEqual(result, { updatePaymentMethod: "https://update-target", cancelSubscription: "https://cancel-target" });
});

test("never uses urls.general.overview: absent from the injected response shape entirely, and never referenced by the result", async () => {
  const result = await resolveSubscriptionManagementUrls(
    CUSTOMER_ID,
    SUBSCRIPTION_ID,
    fakePortalSession({}, [{ id: SUBSCRIPTION_ID, cancelSubscription: "https://cancel-target", updateSubscriptionPaymentMethod: "https://update-target" }]),
  );
  const text = JSON.stringify(result);
  assert.ok(!text.includes("general"));
  assert.ok(!text.includes("overview"));
});

test("no matching subscription entry -> controlled null, not the general overview or another subscription", async () => {
  const result = await resolveSubscriptionManagementUrls(
    CUSTOMER_ID,
    SUBSCRIPTION_ID,
    fakePortalSession({}, [{ id: "sub_other_workspace", cancelSubscription: "https://cancel-other", updateSubscriptionPaymentMethod: "https://update-other" }]),
  );
  assert.equal(result, null);
});

test("matching entry with a missing required URL -> controlled null, no partial result", async () => {
  const result = await resolveSubscriptionManagementUrls(
    CUSTOMER_ID,
    SUBSCRIPTION_ID,
    fakePortalSession({}, [{ id: SUBSCRIPTION_ID, cancelSubscription: "", updateSubscriptionPaymentMethod: "https://update-target" }]),
  );
  assert.equal(result, null);
});
