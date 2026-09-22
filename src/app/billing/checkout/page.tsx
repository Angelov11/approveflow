import { deriveBillingSessionSecret } from "@/lib/billing/billing-session-secret";
import { verifyBillingSessionToken } from "@/lib/billing/billing-session-token";
import { createProCheckoutTransaction } from "@/lib/billing/create-pro-checkout-transaction";
import { isBlockedFromNewCheckout } from "@/lib/billing/duplicate-subscription-guard";
import { findWorkspaceSubscription } from "@/lib/billing/workspace-subscriptions";
import { serverEnv } from "@/lib/env.server";
import { findWorkspaceById } from "@/lib/requests/workspace-lookup";
import { CheckoutClient } from "./checkout-client";

const errorMainStyle = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  textAlign: "center" as const,
  padding: "2rem",
  gap: "0.5rem",
};

function ErrorPage({ message }: { message: string }) {
  return (
    <main style={errorMainStyle}>
      <h1>ApproveGo</h1>
      <p>{message}</p>
    </main>
  );
}

/**
 * Public route — deliberately requires no general ApproveGo login. Trust
 * comes entirely from the signed `session` token (see
 * billing-session-token.ts), not from any session cookie or account
 * system. Every step below re-verifies from scratch — nothing about this
 * request is trusted from the browser except the opaque token string:
 *
 *   1. Verify the token's signature and expiry.
 *   2. Resolve the workspace it names.
 *   3. Re-check the duplicate-subscription guard fresh (never trust the
 *      Slack-side check that generated this link — that state could have
 *      changed since).
 *   4. Create the Paddle Transaction server-side, with PADDLE_PRO_PRICE_ID,
 *      quantity 1, and custom_data.workspace_id all set here — never from
 *      anything the browser sends.
 *
 * The browser receives only the resulting transactionId (via
 * CheckoutClient) — never the workspace UUID, never a price ID it could
 * tamper with.
 */
export default async function BillingCheckoutPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const { session } = await searchParams;
  if (!session) {
    return <ErrorPage message="This billing link is invalid. Please generate a new one from Slack." />;
  }

  const secret = deriveBillingSessionSecret(serverEnv.SLACK_CLIENT_SECRET ?? "");
  const verification = verifyBillingSessionToken(session, "checkout", secret);
  if (!verification.valid) {
    return <ErrorPage message="This billing link is invalid or has expired. Please generate a new one from Slack." />;
  }

  const workspace = await findWorkspaceById(verification.workspaceId);
  if (!workspace) {
    return <ErrorPage message="This workspace could not be found. Please generate a new billing link from Slack." />;
  }

  const existingSubscription = await findWorkspaceSubscription(workspace.id);
  if (isBlockedFromNewCheckout(existingSubscription)) {
    return <ErrorPage message="This workspace already has a billing subscription. Billing management will be available here." />;
  }

  if (!serverEnv.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN) {
    return <ErrorPage message="Checkout is temporarily unavailable. Please try again later." />;
  }

  let transactionId: string;
  try {
    transactionId = await createProCheckoutTransaction(workspace.id);
  } catch (error) {
    // Never log the Paddle API key or a raw Paddle error response body — only a message.
    console.error("Failed to create Paddle checkout transaction:", error instanceof Error ? error.message : "unknown error");
    return <ErrorPage message="Checkout is temporarily unavailable. Please try again later." />;
  }

  return (
    <CheckoutClient
      transactionId={transactionId}
      clientToken={serverEnv.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN}
      environment={serverEnv.PADDLE_ENVIRONMENT === "live" ? "production" : "sandbox"}
    />
  );
}
