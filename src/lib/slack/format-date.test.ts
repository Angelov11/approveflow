import assert from "node:assert/strict";
import test from "node:test";
import { formatSlackDate } from "./format-date.ts";

test("includes the Slack date token with the correct epoch seconds", () => {
  const result = formatSlackDate("2026-09-15T18:15:01.580Z");
  const expectedEpoch = Math.floor(new Date("2026-09-15T18:15:01.580Z").getTime() / 1000);
  assert.ok(result.startsWith(`<!date^${expectedEpoch}^`));
});

test("includes a readable plain-text fallback after the pipe", () => {
  const result = formatSlackDate("2026-09-15T18:15:01.580Z");
  assert.ok(result.includes("|2026-09-15>"));
});

test("uses the {date_short_pretty} and {time} format tokens", () => {
  const result = formatSlackDate("2026-01-01T00:00:00.000Z");
  assert.ok(result.includes("{date_short_pretty}"));
  assert.ok(result.includes("{time}"));
});
