import assert from "node:assert/strict";
import test from "node:test";

import { computeBillingManagementAuthorization } from "./compute-billing-management-authorization.ts";

const OWNER = "354da2b6-a0d3-4eaa-9084-ebc3e11c16b3";
const OTHER_ADMIN = "a1b2c3d4-0000-4000-8000-000000000002";

test("the matching owner is authorized", () => {
  assert.equal(computeBillingManagementAuthorization(OWNER, OWNER), "authorized");
});

test("a different admin is denied (not_owner), never authorized", () => {
  assert.equal(computeBillingManagementAuthorization(OWNER, OTHER_ADMIN), "not_owner");
});

test("a stale token minted for a PREVIOUS owner is denied once ownership has moved to someone else — /billing/manage re-checks current DB state, never trusts the token's claim", () => {
  const currentOwnerAfterOwnershipChanged = OTHER_ADMIN;
  const staleTokenUserId = OWNER;
  assert.equal(computeBillingManagementAuthorization(currentOwnerAfterOwnershipChanged, staleTokenUserId), "not_owner");
});

test("a null owner is denied (no_owner) — there is NO 'any admin may manage' fallback", () => {
  assert.equal(computeBillingManagementAuthorization(null, OTHER_ADMIN), "no_owner");
});

test("a null owner denies even the workspace's own historical/founding admin — null truly means nobody", () => {
  assert.equal(computeBillingManagementAuthorization(null, OWNER), "no_owner");
});

test("composes with the webhook's new-subscription-never-inherits rule: a re-upgrade with a missing/invalid initiating_user_id leaves billing_owner_user_id NULL (see process_paddle_subscription_event), and that NULL denies every admin here — never a silent 'any admin' fallback", () => {
  const billingOwnerUserIdAfterUnattributedReupgrade: string | null = null;
  assert.equal(computeBillingManagementAuthorization(billingOwnerUserIdAfterUnattributedReupgrade, OWNER), "no_owner");
  assert.equal(computeBillingManagementAuthorization(billingOwnerUserIdAfterUnattributedReupgrade, OTHER_ADMIN), "no_owner");
});
