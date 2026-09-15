import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack request signature verification (https://docs.slack.dev/authentication/verifying-requests-from-slack).
 *
 * Pure — no env access, no Next.js/server-only dependency — so it's unit
 * testable. Callers (route handlers, which are inherently server-only in
 * Next.js) pass in the signing secret sourced from env.server.ts.
 *
 * Must be called with the EXACT raw request body string Slack sent — never
 * a re-serialized/re-parsed form body, since that can differ byte-for-byte
 * from what was signed.
 */

const SIGNATURE_PATTERN = /^v0=[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d+$/;
const DEFAULT_TOLERANCE_SECONDS = 60 * 5;

export interface VerifySlackRequestParams {
  signingSecret: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  /** Current time in seconds since epoch. Injectable for deterministic tests. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export function isValidSlackRequest({
  signingSecret,
  rawBody,
  timestamp,
  signature,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
}: VerifySlackRequestParams): boolean {
  if (!timestamp || !signature) {
    return false;
  }
  if (!TIMESTAMP_PATTERN.test(timestamp)) {
    return false;
  }
  // Reject stale (or future-dated) timestamps to prevent replay attacks.
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) {
    return false;
  }
  if (!SIGNATURE_PATTERN.test(signature)) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;

  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
