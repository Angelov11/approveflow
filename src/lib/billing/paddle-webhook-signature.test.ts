import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { verifyAndParsePaddleWebhook } from "./paddle-webhook-signature.ts";

const SECRET = "test-webhook-secret";

/** Mirrors exactly what Paddle's own signature algorithm does (confirmed from the installed SDK's webhooks-validator source): HMAC-SHA256 over `${ts}:${rawBody}`. */
function sign(rawBody: string, secret: string, tsSeconds: number): string {
  const hash = createHmac("sha256", secret).update(`${tsSeconds}:${rawBody}`).digest("hex");
  return `ts=${tsSeconds};h1=${hash}`;
}

function samplePayload(overrides: { eventId?: string; status?: string } = {}): string {
  return JSON.stringify({
    event_id: overrides.eventId ?? "evt_1",
    notification_id: "ntf_1",
    event_type: "subscription.created",
    occurred_at: "2026-09-19T00:00:00.000000Z",
    data: {
      id: "sub_1",
      status: overrides.status ?? "active",
      transaction_id: "txn_1",
      customer_id: "ctm_1",
      address_id: "add_1",
      currency_code: "USD",
      created_at: "2026-09-19T00:00:00.000000Z",
      updated_at: "2026-09-19T00:00:00.000000Z",
      collection_mode: "automatic",
      billing_cycle: { interval: "month", frequency: 1 },
      items: [],
      custom_data: { workspace_id: "c94923d9-cc5b-451c-bffe-8501a36a4eeb" },
    },
  });
}

test("a validly signed event verifies and parses successfully", async () => {
  const body = samplePayload();
  const ts = Math.floor(Date.now() / 1000);
  const event = await verifyAndParsePaddleWebhook(body, SECRET, sign(body, SECRET, ts));
  assert.equal(event.eventId, "evt_1");
  assert.equal(event.eventType, "subscription.created");
});

test("an invalid signature is rejected", async () => {
  const body = samplePayload();
  const ts = Math.floor(Date.now() / 1000);
  const signature = `ts=${ts};h1=${"0".repeat(64)}`;
  await assert.rejects(() => verifyAndParsePaddleWebhook(body, SECRET, signature));
});

test("a mutated body fails verification even against an otherwise-valid signature", async () => {
  const body = samplePayload();
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(body, SECRET, ts);
  const tamperedBody = samplePayload({ status: "canceled" });
  await assert.rejects(() => verifyAndParsePaddleWebhook(tamperedBody, SECRET, signature));
});

test("a malformed signature header is rejected", async () => {
  const body = samplePayload();
  await assert.rejects(() => verifyAndParsePaddleWebhook(body, SECRET, "not-a-valid-signature-header"));
});

test("a missing signature header value is rejected", async () => {
  const body = samplePayload();
  await assert.rejects(() => verifyAndParsePaddleWebhook(body, SECRET, ""));
});

test("a stale timestamp beyond the SDK's tolerance is rejected", async () => {
  const body = samplePayload();
  const ts = Math.floor(Date.now() / 1000) - 30;
  await assert.rejects(() => verifyAndParsePaddleWebhook(body, SECRET, sign(body, SECRET, ts)));
});

test("the wrong secret is rejected", async () => {
  const body = samplePayload();
  const ts = Math.floor(Date.now() / 1000);
  await assert.rejects(() => verifyAndParsePaddleWebhook(body, "wrong-secret", sign(body, SECRET, ts)));
});

test("a malformed (non-JSON) body fails even with a signature computed over that same malformed body", async () => {
  const body = "not valid json{{{";
  const ts = Math.floor(Date.now() / 1000);
  await assert.rejects(() => verifyAndParsePaddleWebhook(body, SECRET, sign(body, SECRET, ts)));
});
