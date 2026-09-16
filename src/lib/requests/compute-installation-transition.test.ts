import assert from "node:assert/strict";
import test from "node:test";

import { computeInstallationTransition } from "./compute-installation-transition.ts";

test("INSTALLED + app_uninstalled -> UNINSTALLED, sets uninstalled_at, clears token", () => {
  const result = computeInstallationTransition({ currentStatus: "INSTALLED", event: "app_uninstalled" });
  assert.deepEqual(result, { nextStatus: "UNINSTALLED", shouldSetUninstalledAt: true, shouldClearToken: true });
});

test("INSTALLED + tokens_revoked -> TOKEN_REVOKED, does not touch uninstalled_at, clears token", () => {
  const result = computeInstallationTransition({ currentStatus: "INSTALLED", event: "tokens_revoked" });
  assert.deepEqual(result, { nextStatus: "TOKEN_REVOKED", shouldSetUninstalledAt: false, shouldClearToken: true });
});

test("TOKEN_REVOKED + app_uninstalled -> UNINSTALLED, sets uninstalled_at (first time), clears token", () => {
  const result = computeInstallationTransition({ currentStatus: "TOKEN_REVOKED", event: "app_uninstalled" });
  assert.deepEqual(result, { nextStatus: "UNINSTALLED", shouldSetUninstalledAt: true, shouldClearToken: true });
});

test("UNINSTALLED + tokens_revoked -> remains UNINSTALLED, does not touch uninstalled_at", () => {
  const result = computeInstallationTransition({ currentStatus: "UNINSTALLED", event: "tokens_revoked" });
  assert.deepEqual(result, { nextStatus: "UNINSTALLED", shouldSetUninstalledAt: false, shouldClearToken: true });
});

test("duplicate app_uninstalled (already UNINSTALLED) leaves the original uninstalled_at intact", () => {
  const result = computeInstallationTransition({ currentStatus: "UNINSTALLED", event: "app_uninstalled" });
  assert.deepEqual(result, { nextStatus: "UNINSTALLED", shouldSetUninstalledAt: false, shouldClearToken: true });
});

test("duplicate tokens_revoked (already TOKEN_REVOKED) is a harmless no-op transition", () => {
  const result = computeInstallationTransition({ currentStatus: "TOKEN_REVOKED", event: "tokens_revoked" });
  assert.deepEqual(result, { nextStatus: "TOKEN_REVOKED", shouldSetUninstalledAt: false, shouldClearToken: true });
});

test("both delivery orders converge on the same final state: uninstall then revoke", () => {
  const afterUninstall = computeInstallationTransition({ currentStatus: "INSTALLED", event: "app_uninstalled" });
  assert.equal(afterUninstall.nextStatus, "UNINSTALLED");
  const afterRevokeToo = computeInstallationTransition({ currentStatus: afterUninstall.nextStatus, event: "tokens_revoked" });
  assert.equal(afterRevokeToo.nextStatus, "UNINSTALLED");
  assert.equal(afterRevokeToo.shouldSetUninstalledAt, false);
});

test("both delivery orders converge on the same final state: revoke then uninstall", () => {
  const afterRevoke = computeInstallationTransition({ currentStatus: "INSTALLED", event: "tokens_revoked" });
  assert.equal(afterRevoke.nextStatus, "TOKEN_REVOKED");
  const afterUninstallToo = computeInstallationTransition({ currentStatus: afterRevoke.nextStatus, event: "app_uninstalled" });
  assert.equal(afterUninstallToo.nextStatus, "UNINSTALLED");
  assert.equal(afterUninstallToo.shouldSetUninstalledAt, true);
});

test("UNINSTALLED always wins as the final state regardless of order", () => {
  const orderA = computeInstallationTransition({
    currentStatus: computeInstallationTransition({ currentStatus: "INSTALLED", event: "app_uninstalled" }).nextStatus,
    event: "tokens_revoked",
  });
  const orderB = computeInstallationTransition({
    currentStatus: computeInstallationTransition({ currentStatus: "INSTALLED", event: "tokens_revoked" }).nextStatus,
    event: "app_uninstalled",
  });
  assert.equal(orderA.nextStatus, "UNINSTALLED");
  assert.equal(orderB.nextStatus, "UNINSTALLED");
});

test("every transition requests the token be cleared — INSTALLED is never a reachable nextStatus from these events", () => {
  const cases: Array<Parameters<typeof computeInstallationTransition>[0]> = [
    { currentStatus: "INSTALLED", event: "app_uninstalled" },
    { currentStatus: "INSTALLED", event: "tokens_revoked" },
    { currentStatus: "TOKEN_REVOKED", event: "app_uninstalled" },
    { currentStatus: "TOKEN_REVOKED", event: "tokens_revoked" },
    { currentStatus: "UNINSTALLED", event: "app_uninstalled" },
    { currentStatus: "UNINSTALLED", event: "tokens_revoked" },
  ];
  for (const input of cases) {
    const result = computeInstallationTransition(input);
    assert.equal(result.shouldClearToken, true);
    assert.notEqual(result.nextStatus, "INSTALLED");
  }
});
