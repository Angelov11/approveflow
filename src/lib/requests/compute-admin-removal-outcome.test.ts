import assert from "node:assert/strict";
import test from "node:test";

import { computeAdminRemovalOutcome } from "./compute-admin-removal-outcome.ts";

test("removing a non-last admin from a workspace with multiple admins succeeds", () => {
  assert.equal(computeAdminRemovalOutcome(["A", "B"], "A"), "removed");
});

test("removing the sole remaining admin is refused", () => {
  assert.equal(computeAdminRemovalOutcome(["A"], "A"), "last_admin");
});

test("removing someone who isn't currently an admin is reported distinctly from last_admin", () => {
  assert.equal(computeAdminRemovalOutcome(["A", "B"], "C"), "not_admin");
});

test("an empty admin list (should not normally happen) still fails safely, never 'removed'", () => {
  assert.equal(computeAdminRemovalOutcome([], "A"), "not_admin");
});

test("self-removal is not special-cased — it's just removal of a user id that happens to match the acting admin, subject to the same last-admin rule", () => {
  // Two admins, A removes themselves (A) -> succeeds, B remains.
  assert.equal(computeAdminRemovalOutcome(["A", "B"], "A"), "removed");
  // One admin, A removes themselves -> refused, exactly like removing anyone else would be.
  assert.equal(computeAdminRemovalOutcome(["A"], "A"), "last_admin");
});

test("the concurrent A-removes-B / B-removes-A race resolves safely when applied as a sequential snapshot-then-decide, matching what the workspace-row lock serializes to in the real RPC", () => {
  // Simulates two admins each computing an outcome against a *consistent*
  // snapshot, one after the other (the real RPC guarantees this ordering
  // via `select ... from workspaces where id = $1 for update`, which this
  // pure function cannot itself provide — see its own header comment).
  const initialAdmins = ["A", "B"];
  const firstOutcome = computeAdminRemovalOutcome(initialAdmins, "B"); // A removes B
  assert.equal(firstOutcome, "removed");

  const adminsAfterFirstRemoval = initialAdmins.filter((id) => id !== "B");
  const secondOutcome = computeAdminRemovalOutcome(adminsAfterFirstRemoval, "A"); // B (now removed) attempts to remove A
  assert.equal(secondOutcome, "last_admin");

  // End state: exactly one admin remains — zero admins was never reachable.
  assert.equal(adminsAfterFirstRemoval.length, 1);
});
