import assert from "node:assert/strict";
import test from "node:test";

import { computeRequestRoutingDecision } from "./compute-request-routing.ts";

test("no active policy + a valid selected approver -> DIRECT", () => {
  const result = computeRequestRoutingDecision(false, "U0MIKE456");
  assert.deepEqual(result, { kind: "direct", approverSlackId: "U0MIKE456" });
});

test("stale DIRECT-believing modal + a policy that became active before submission -> POLICY, approver ignored", () => {
  // The modal thought DIRECT applied and collected an approver; server-side
  // truth now says a policy is active. POLICY wins regardless of the
  // approver value — it's not even inspected.
  const result = computeRequestRoutingDecision(true, "U0MIKE456");
  assert.deepEqual(result, { kind: "policy" });
});

test("active policy with no approver collected (the normal/expected case) -> POLICY", () => {
  const result = computeRequestRoutingDecision(true, null);
  assert.deepEqual(result, { kind: "policy" });
});

test("stale POLICY-believing modal + the policy was disabled before submission + no approver collected -> rejected, never a guessed approver", () => {
  const result = computeRequestRoutingDecision(false, null);
  assert.deepEqual(result, { kind: "rejected_stale_modal" });
});

test("a manually-selected approver can never override an active policy", () => {
  // Same as the stale-modal case above, restated as its own scenario per
  // the M9 test plan: whatever the modal collected, POLICY still wins.
  for (const approver of [null, "U0ANYONE"]) {
    assert.deepEqual(computeRequestRoutingDecision(true, approver), { kind: "policy" });
  }
});
