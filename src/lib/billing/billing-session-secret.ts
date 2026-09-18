import { createHmac } from "node:crypto";

/**
 * There's no dedicated env var for signing the billing-session token. Same
 * domain-separation approach as deriveOAuthStateSecret
 * (src/lib/slack/state-secret.ts) — derive a purpose-specific secret from
 * the existing Slack client secret rather than reusing it raw, and rather
 * than reusing the OAuth-state derivation's own output (a different domain
 * string here means a completely different derived secret, so a token
 * signed for one purpose can never validate against the other). Pure/no
 * env access so it stays unit-testable.
 */
export function deriveBillingSessionSecret(clientSecret: string): string {
  return createHmac("sha256", clientSecret).update("approveflow:billing-session").digest("hex");
}
