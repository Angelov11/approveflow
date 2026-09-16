import assert from "node:assert/strict";
import test from "node:test";

import { createRequestTimer } from "./timing.ts";

function fakeClock(start: number) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

test("ack() logs a summary line with the correlation id, route, and flow", () => {
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "request_type_changed", { requestId: "fixed-id", log: (l) => lines.push(l) });
  timer.ack("ok");

  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, "timing");
  assert.equal(lines[0].requestId, "fixed-id");
  assert.equal(lines[0].route, "interactions");
  assert.equal(lines[0].flow, "request_type_changed");
  assert.equal(lines[0].stage, "ack");
  assert.equal(lines[0].outcome, "ok");
});

test("ack() is 'info' level under the warn threshold", () => {
  const clock = fakeClock(0);
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { now: clock.now, log: (l) => lines.push(l) });
  clock.advance(500);
  timer.ack("ok");
  assert.equal(lines[0].level, "info");
  assert.equal(lines[0].ackMs, 500);
});

test("ack() is 'warn' level at/above 1000ms", () => {
  const clock = fakeClock(0);
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { now: clock.now, log: (l) => lines.push(l) });
  clock.advance(1200);
  timer.ack("ok");
  assert.equal(lines[0].level, "warn");
});

test("ack() is 'error' level at/above 2500ms — approaching/exceeding Slack's 3s window", () => {
  const clock = fakeClock(0);
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { now: clock.now, log: (l) => lines.push(l) });
  clock.advance(2600);
  timer.ack("ok");
  assert.equal(lines[0].level, "error");
});

test("time() accumulates db/slack_api totals separately and reports them in the ack summary", async () => {
  const clock = fakeClock(0);
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { now: clock.now, log: (l) => lines.push(l) });

  await timer.time("db", "findWorkspace", async () => {
    clock.advance(50);
    return "ok";
  });
  await timer.time("db", "upsertUser", async () => {
    clock.advance(30);
    return "ok";
  });
  await timer.time("slack_api", "views.open", async () => {
    clock.advance(200);
    return "ok";
  });
  timer.ack("ok");

  const summary = lines.at(-1) as Record<string, unknown>;
  assert.equal(summary.dbTotalMs, 80);
  assert.equal(summary.slackApiTotalMs, 200);
});

test("time() logs an individual slow-call line when a single db call exceeds its threshold, without swallowing the result", async () => {
  const clock = fakeClock(0);
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { now: clock.now, log: (l) => lines.push(l) });

  const result = await timer.time("db", "slowQuery", async () => {
    clock.advance(450);
    return 42;
  });

  assert.equal(result, 42);
  const slowLine = lines.find((l) => l.stage === "call");
  assert.ok(slowLine, "expected a slow-call line to be logged");
  assert.equal(slowLine?.bucket, "db");
  assert.equal(slowLine?.label, "slowQuery");
  assert.equal(slowLine?.slow, true);
});

test("time() does not log anything for a fast call under threshold", async () => {
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { log: (l) => lines.push(l) });
  await timer.time("db", "fastQuery", async () => "ok");
  assert.equal(lines.length, 0);
});

test("time() still records the elapsed time and rethrows when the wrapped call fails", async () => {
  const clock = fakeClock(0);
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { now: clock.now, log: (l) => lines.push(l) });

  await assert.rejects(
    timer.time("slack_api", "views.update", async () => {
      clock.advance(10);
      throw new Error("boom");
    }),
    /boom/,
  );

  timer.ack("error");
  const summary = lines.at(-1) as Record<string, unknown>;
  assert.equal(summary.slackApiTotalMs, 10);
});

test("afterTask() logs its own ok outcome and duration, independent of ack()", async () => {
  const clock = fakeClock(0);
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { now: clock.now, log: (l) => lines.push(l) });

  const result = await timer.afterTask("notifyApprovers", async () => {
    clock.advance(75);
    return "done";
  });

  assert.equal(result, "done");
  const afterLine = lines.find((l) => l.stage === "after");
  assert.equal(afterLine?.label, "notifyApprovers");
  assert.equal(afterLine?.afterOutcome, "ok");
  assert.equal(afterLine?.afterMs, 75);
});

test("afterTask() logs a sanitized error outcome and rethrows on failure", async () => {
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { log: (l) => lines.push(l) });

  await assert.rejects(
    timer.afterTask("notifyApprovers", async () => {
      throw new Error("Slack API said no");
    }),
    /Slack API said no/,
  );

  const afterLine = lines.find((l) => l.stage === "after");
  assert.equal(afterLine?.afterOutcome, "error");
  assert.equal(afterLine?.afterError, "Slack API said no");
});

test("markVerify()/markParse() are reported in the ack summary, separate from db/slack totals", () => {
  const lines: Record<string, unknown>[] = [];
  const timer = createRequestTimer("interactions", "x", { log: (l) => lines.push(l) });
  timer.markVerify(3);
  timer.markParse(1);
  timer.ack("ok");
  assert.equal(lines[0].verifyMs, 3);
  assert.equal(lines[0].parseMs, 1);
});

test("a fresh requestId is generated when none is injected", () => {
  const timerA = createRequestTimer("interactions", "x", { log: () => {} });
  const timerB = createRequestTimer("interactions", "x", { log: () => {} });
  assert.notEqual(timerA.requestId, timerB.requestId);
  assert.match(timerA.requestId, /^[0-9a-f-]{36}$/);
});
