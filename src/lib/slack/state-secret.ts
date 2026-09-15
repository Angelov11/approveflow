import { createHmac } from "node:crypto";

/**
 * There's no dedicated env var for signing the Slack OAuth `state` CSRF
 * token. Rather than reusing the raw Slack client secret as an HMAC key for
 * a second purpose, derive a domain-separated secret from it. Pure/no env
 * access so it stays unit-testable.
 */
export function deriveOAuthStateSecret(clientSecret: string): string {
  return createHmac("sha256", clientSecret).update("approveflow:slack-oauth-state").digest("hex");
}
