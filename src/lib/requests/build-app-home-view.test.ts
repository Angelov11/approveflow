import assert from "node:assert/strict";
import test from "node:test";
import { buildAppHomeView, HOME_RECENT_REQUESTS_LIMIT } from "./build-app-home-view.ts";
import type { RequestSummary } from "./build-requests-views.ts";

function blocksToText(view: { blocks?: unknown[] }): string {
  return JSON.stringify(view.blocks);
}

const sampleRequest: RequestSummary = {
  id: "req-1",
  requestTypeName: "Custom Request",
  resource: "AWS Test Resource",
  status: "PENDING",
  whenText: "2 hours",
  amountText: null,
  createdAt: "2026-09-15T20:00:00.000Z",
};

test("shows the product intro/tagline and Create Request as the sole top-level action", () => {
  const view = buildAppHomeView({  recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("ApproveGo"));
  assert.ok(text.includes("create_request_home"));
  assert.ok(text.includes("Create Request"));
});

test("does not render a top-level 'Open Request Center' button (Home is now the primary surface)", () => {
  const view = buildAppHomeView({  recentRequests: [sampleRequest], myRequestsTotalCount: 20, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  assert.ok(!blocksToText(view).includes("Open Request Center"));
});

test("My Requests empty state shows the exact required message", () => {
  const view = buildAppHomeView({  recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  assert.ok(blocksToText(view).includes("You haven't submitted any requests yet."));
});

test("My Requests renders each row's request type, resource, status, duration, and a View button", () => {
  const view = buildAppHomeView({  recentRequests: [sampleRequest], myRequestsTotalCount: 1, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("Custom Request"));
  assert.ok(text.includes("AWS Test Resource"));
  assert.ok(text.includes("Pending"));
  assert.ok(text.includes("2 hours"));
  assert.ok(text.includes("view_request"));
  assert.ok(text.includes("requestId"));
  assert.ok(text.includes("req-1"));
});

test("never renders more rows than it was given (caller enforces the Home limit)", () => {
  const many = Array.from({ length: HOME_RECENT_REQUESTS_LIMIT }, (_, i) => ({ ...sampleRequest, id: `req-${i}` }));
  const view = buildAppHomeView({  recentRequests: many, myRequestsTotalCount: HOME_RECENT_REQUESTS_LIMIT, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const viewButtonCount = (blocksToText(view).match(/view_request/g) ?? []).length;
  assert.equal(viewButtonCount, HOME_RECENT_REQUESTS_LIMIT);
});

test("'View all requests' is hidden when the total count doesn't exceed what's already shown", () => {
  const view = buildAppHomeView({  recentRequests: [sampleRequest], myRequestsTotalCount: 1, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  assert.ok(!blocksToText(view).includes("View all requests"));
});

test("'View all requests' is hidden when there are no requests at all", () => {
  const view = buildAppHomeView({  recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  assert.ok(!blocksToText(view).includes("View all requests"));
});

test("'View all requests' appears, reusing the Request Center action id, when more requests exist than are shown", () => {
  const view = buildAppHomeView({  recentRequests: [sampleRequest], myRequestsTotalCount: 12, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("View all requests"));
  assert.ok(text.includes("open_request_center"));
});

test("Waiting for Me empty state shows the exact required message and no button", () => {
  const view = buildAppHomeView({  recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("Nothing is waiting for your approval."));
  assert.ok(!text.includes("view_waiting_requests"));
});

test("Waiting for Me shows the count and a pending-approvals button when non-zero", () => {
  const view = buildAppHomeView({  recentRequests: [], myRequestsTotalCount: 0, waitingCount: 3 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("3"));
  assert.ok(text.includes("view_waiting_requests"));
  assert.ok(text.includes("View pending approvals"));
});

test("singular vs. plural phrasing for a waiting count of exactly 1", () => {
  const view = buildAppHomeView({  recentRequests: [], myRequestsTotalCount: 0, waitingCount: 1 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("request needs your decision."));
  assert.ok(!text.includes("requests need"));
});

test("never exposes internal UUIDs, routing_type strings, or column names", () => {
  const view = buildAppHomeView({  recentRequests: [sampleRequest], myRequestsTotalCount: 12, waitingCount: 2 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(!text.includes("approval_policy_id"));
  assert.ok(!text.includes("direct_approver_id"));
  assert.ok(!text.includes("routing_type"));
  assert.ok(!text.includes("workspace_id"));
});

test("the returned view is typed as a Home tab view", () => {
  const view = buildAppHomeView({  recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0 , isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  assert.equal(view.type, "home");
});

// --- M9: Administration section ---

test("a regular (non-admin) user sees no Administration section at all", () => {
  const view = buildAppHomeView({ recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0, isAdmin: false, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(!text.includes("Administration"));
  assert.ok(!text.includes("manage_administrators"));
  assert.ok(!text.includes("manage_approval_policies"));
});

test("an admin sees the Administration section with both management buttons", () => {
  const view = buildAppHomeView({ recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0, isAdmin: true, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("Administration"));
  assert.ok(text.includes("manage_approval_policies"));
  assert.ok(text.includes("Manage Approval Policies"));
  assert.ok(text.includes("manage_administrators"));
  assert.ok(text.includes("Manage Administrators"));
});

test("the Administration section appears after the normal Home sections, never replacing them", () => {
  const view = buildAppHomeView({ recentRequests: [sampleRequest], myRequestsTotalCount: 1, waitingCount: 2, isAdmin: true, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.indexOf("My Requests") < text.indexOf("Administration"));
  assert.ok(text.indexOf("Waiting for Me") < text.indexOf("Administration"));
});

// --- M10.2: Billing section ---

test("a non-admin never sees a Billing section, even for a Pro workspace", () => {
  const view = buildAppHomeView({ recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0, isAdmin: false, plan: "PRO", billingActions: { canUpgrade: false, canManageBilling: true }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(!text.includes("Billing"));
  assert.ok(!text.includes("upgrade_to_pro"));
  assert.ok(!text.includes("manage_billing"));
});

test("a Free admin sees the Billing section with the Upgrade to Pro button and never says 'Unlimited'", () => {
  const view = buildAppHomeView({ recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0, isAdmin: true, plan: "FREE", billingActions: { canUpgrade: true, canManageBilling: false }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("Billing"));
  assert.ok(text.includes("Free"));
  assert.ok(text.includes("Approval Policies are available on Pro."));
  assert.ok(text.includes("ApproveGo Pro"));
  assert.ok(text.includes("$19/month"));
  assert.ok(text.includes("upgrade_to_pro"));
  assert.ok(text.includes("Upgrade to Pro"));
  assert.ok(!text.includes("manage_billing"));
  assert.ok(!text.toLowerCase().includes("unlimited"));
});

test("a Pro admin sees the Billing section with a Manage Billing button and no Upgrade button", () => {
  const view = buildAppHomeView({ recentRequests: [], myRequestsTotalCount: 0, waitingCount: 0, isAdmin: true, plan: "PRO", billingActions: { canUpgrade: false, canManageBilling: true }, isBillingOwner: true, billingOwnerSlackUserId: null });
  const text = blocksToText(view);
  assert.ok(text.includes("Billing"));
  assert.ok(text.includes("Pro"));
  assert.ok(text.includes("manage_billing"));
  assert.ok(text.includes("Manage Billing"));
  assert.ok(!text.includes("upgrade_to_pro"));
});

// --- M10.3: Billing-action visibility (paused/canceled) ---

test("a paused workspace's admin sees Manage Billing only, never Upgrade (checkout would reject it anyway)", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "FREE",
    billingActions: { canUpgrade: false, canManageBilling: true },
    isBillingOwner: true,
    billingOwnerSlackUserId: null,
  });
  const text = blocksToText(view);
  assert.ok(text.includes("Billing"));
  assert.ok(text.includes("manage_billing"));
  assert.ok(text.includes("Manage Billing"));
  assert.ok(!text.includes("upgrade_to_pro"));
});

test("a canceled workspace's admin sees BOTH Manage Billing and an upgrade-again button, never forced to choose", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "FREE",
    billingActions: { canUpgrade: true, canManageBilling: true },
    isBillingOwner: true,
    billingOwnerSlackUserId: null,
  });
  const text = blocksToText(view);
  assert.ok(text.includes("Billing"));
  assert.ok(text.includes("manage_billing"));
  assert.ok(text.includes("Manage Billing"));
  assert.ok(text.includes("upgrade_to_pro"));
});

// --- POST-M11-B2: Billing ownership gating ---

test("a Pro admin who is NOT the billing owner sees plan/status text only, no Manage Billing button, and a 'Managed by' mention", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "PRO",
    billingActions: { canUpgrade: false, canManageBilling: true },
    isBillingOwner: false,
    billingOwnerSlackUserId: "U_OWNER",
  });
  const text = blocksToText(view);
  assert.ok(text.includes("Billing"));
  assert.ok(text.includes("Pro"));
  assert.ok(!text.includes("manage_billing"));
  assert.ok(!text.includes("Manage Billing"));
  assert.ok(text.includes("Managed by <@U_OWNER>"));
});

test("a Pro admin who IS the billing owner sees the Manage Billing button", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "PRO",
    billingActions: { canUpgrade: false, canManageBilling: true },
    isBillingOwner: true,
    billingOwnerSlackUserId: "U_OWNER",
  });
  const text = blocksToText(view);
  assert.ok(text.includes("manage_billing"));
  assert.ok(text.includes("Manage Billing"));
  assert.ok(!text.includes("Managed by"));
});

test("POST-M11-B2 corrected: a Pro admin with no owner recorded (null owner) sees NO Manage Billing button, and no admin is implied responsible", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "PRO",
    billingActions: { canUpgrade: false, canManageBilling: true },
    isBillingOwner: false,
    billingOwnerSlackUserId: null,
  });
  const text = blocksToText(view);
  assert.ok(!text.includes("manage_billing"));
  assert.ok(!text.includes("Manage Billing"));
  assert.ok(!text.includes("Managed by"));
});

test("canceled: a non-owner admin still sees Upgrade Again, but not Manage Billing", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "FREE",
    billingActions: { canUpgrade: true, canManageBilling: true },
    isBillingOwner: false,
    billingOwnerSlackUserId: "U_OWNER",
  });
  const text = blocksToText(view);
  assert.ok(text.includes("upgrade_to_pro"));
  assert.ok(text.includes("Upgrade Again"));
  assert.ok(!text.includes("manage_billing"));
  assert.ok(!text.includes("Manage Billing"));
  assert.ok(text.includes("Managed by <@U_OWNER>"));
});

test("canceled: the owner sees both Manage Billing and Upgrade Again", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "FREE",
    billingActions: { canUpgrade: true, canManageBilling: true },
    isBillingOwner: true,
    billingOwnerSlackUserId: "U_OWNER",
  });
  const text = blocksToText(view);
  assert.ok(text.includes("upgrade_to_pro"));
  assert.ok(text.includes("manage_billing"));
  assert.ok(text.includes("Manage Billing"));
});

test("paused: a non-owner admin sees status text only, no Manage Billing", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "FREE",
    billingActions: { canUpgrade: false, canManageBilling: true },
    isBillingOwner: false,
    billingOwnerSlackUserId: "U_OWNER",
  });
  const text = blocksToText(view);
  assert.ok(text.includes("Billing"));
  assert.ok(!text.includes("manage_billing"));
  assert.ok(!text.includes("Manage Billing"));
  assert.ok(text.includes("Managed by <@U_OWNER>"));
});

test("paused: the owner sees the Manage Billing button", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "FREE",
    billingActions: { canUpgrade: false, canManageBilling: true },
    isBillingOwner: true,
    billingOwnerSlackUserId: "U_OWNER",
  });
  const text = blocksToText(view);
  assert.ok(text.includes("manage_billing"));
  assert.ok(text.includes("Manage Billing"));
});

test("paused: a null owner sees no Manage Billing and no implied owner mention", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "FREE",
    billingActions: { canUpgrade: false, canManageBilling: true },
    isBillingOwner: false,
    billingOwnerSlackUserId: null,
  });
  const text = blocksToText(view);
  assert.ok(!text.includes("manage_billing"));
  assert.ok(!text.includes("Manage Billing"));
  assert.ok(!text.includes("Managed by"));
});

test("canceled: a null owner still sees Upgrade Again (never blocked), but no Manage Billing and no implied owner mention", () => {
  const view = buildAppHomeView({
    recentRequests: [],
    myRequestsTotalCount: 0,
    waitingCount: 0,
    isAdmin: true,
    plan: "FREE",
    billingActions: { canUpgrade: true, canManageBilling: true },
    isBillingOwner: false,
    billingOwnerSlackUserId: null,
  });
  const text = blocksToText(view);
  assert.ok(text.includes("upgrade_to_pro"));
  assert.ok(text.includes("Upgrade Again"));
  assert.ok(!text.includes("manage_billing"));
  assert.ok(!text.includes("Manage Billing"));
  assert.ok(!text.includes("Managed by"));
});
