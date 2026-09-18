import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, short-lived token carrying a workspace_id into the checkout
 * page's URL, so the raw UUID is never a trusted-by-itself URL parameter —
 * the checkout route must verify this signature and expiry before
 * resolving the workspace at all. Same architecture as
 * src/lib/slack/verify-request.ts (constant-time comparison, injectable
 * `nowSeconds` for deterministic tests), applied to a signed payload
 * instead of a raw-body signature.
 *
 * 15 minutes: long enough for an admin to read the App Home billing
 * section, click Upgrade, and complete an interactive Paddle Checkout
 * without the link expiring mid-flow, short enough to bound how long a
 * leaked/forwarded link stays useful.
 */
export const BILLING_SESSION_TOKEN_TTL_SECONDS = 15 * 60;

interface BillingSessionPayload {
  workspaceId: string;
  exp: number;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string | null {
  try {
    return Buffer.from(input, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export interface CreateBillingSessionTokenParams {
  workspaceId: string;
  secret: string;
  /** Injectable for deterministic tests. */
  nowSeconds?: number;
  ttlSeconds?: number;
}

export function createBillingSessionToken({
  workspaceId,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = BILLING_SESSION_TOKEN_TTL_SECONDS,
}: CreateBillingSessionTokenParams): string {
  const payload: BillingSessionPayload = { workspaceId, exp: nowSeconds + ttlSeconds };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("hex");
  return `${encodedPayload}.${signature}`;
}

export type VerifyBillingSessionTokenResult =
  | { valid: true; workspaceId: string }
  | { valid: false; reason: "malformed" | "tampered" | "expired" };

export function verifyBillingSessionToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyBillingSessionTokenResult {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "malformed" };
  }
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return { valid: false, reason: "malformed" };
  }

  // Verify the signature BEFORE trusting anything decoded from the payload.
  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { valid: false, reason: "tampered" };
  }

  const decoded = base64UrlDecode(encodedPayload);
  if (!decoded) {
    return { valid: false, reason: "malformed" };
  }
  let payload: BillingSessionPayload;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (typeof payload.workspaceId !== "string" || payload.workspaceId.length === 0 || typeof payload.exp !== "number") {
    return { valid: false, reason: "malformed" };
  }

  if (nowSeconds > payload.exp) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, workspaceId: payload.workspaceId };
}
