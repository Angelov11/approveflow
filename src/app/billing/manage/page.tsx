import { deriveBillingSessionSecret } from "@/lib/billing/billing-session-secret";
import { verifyBillingSessionToken } from "@/lib/billing/billing-session-token";
import { computeBillingManagementAuthorization } from "@/lib/billing/compute-billing-management-authorization";
import { createSubscriptionManagementUrls } from "@/lib/billing/create-customer-portal-session";
import { findWorkspaceSubscription } from "@/lib/billing/workspace-subscriptions";
import { serverEnv } from "@/lib/env.server";
import { findWorkspaceById } from "@/lib/requests/workspace-lookup";

const mainStyle = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  textAlign: "center" as const,
  padding: "2rem",
  gap: "0.75rem",
};

const primaryButtonStyle = {
  display: "inline-block",
  padding: "0.6rem 1.25rem",
  borderRadius: "6px",
  background: "#2563eb",
  color: "#fff",
  textDecoration: "none",
  fontSize: "0.95rem",
};

const secondaryButtonStyle = {
  display: "inline-block",
  padding: "0.6rem 1.25rem",
  borderRadius: "6px",
  background: "transparent",
  color: "#9aa0a6",
  border: "1px solid #3a3a3a",
  textDecoration: "none",
  fontSize: "0.95rem",
};

function ErrorPage({ message }: { message: string }) {
  return (
    <main style={mainStyle}>
      <h1>ApproveGo</h1>
      <p>{message}</p>
    </main>
  );
}

/**
 * Public route, same trust model as /billing/checkout — a verified signed
 * token is the only thing that authorizes this, never a session cookie.
 * Paddle URLs are only ever generated after that verification and a
 * server-side subscription lookup succeed — never exposed earlier.
 *
 * POST-M11-B1: renders two subscription-specific action links instead of
 * redirecting to Paddle's general customer-overview page. A single Paddle
 * Sandbox customer can legitimately own more than one ApproveGo
 * workspace's subscription (confirmed during M11.5, where this ambiguity
 * caused a real cancellation attempt to select the wrong subscription) —
 * the general page can't distinguish them, so it's never used here.
 * Deliberately does not offer invoice history: Paddle's API exposes only
 * per-subscription cancel/update-payment-method deep links, not a
 * subscription-scoped invoice view — see createSubscriptionManagementUrls.
 *
 * No workspace name is shown: it isn't stored anywhere in this schema
 * (only the opaque Slack team id is), and adding a column or a live Slack
 * API call solely for this cosmetic label isn't justified for a minimal
 * page reached only via a link generated from inside that exact
 * workspace's own Slack instance.
 *
 * POST-M11-B2: independently re-verifies CURRENT billing ownership from
 * the database — never trusts that the token was valid for the owner at
 * issuance time. A token minted for A, replayed after ownership has
 * since changed to B, is denied here even though the token's signature,
 * purpose, and expiry all still check out — possession of a previously
 * issued token is deliberately not enough on its own.
 */
export default async function BillingManagePage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const { session } = await searchParams;
  if (!session) {
    return <ErrorPage message="This billing link is invalid. Please generate a new one from Slack." />;
  }

  const secret = deriveBillingSessionSecret(serverEnv.SLACK_CLIENT_SECRET ?? "");
  const verification = verifyBillingSessionToken(session, "manage_billing", secret);
  if (!verification.valid) {
    return <ErrorPage message="This billing link is invalid or has expired. Please generate a new one from Slack." />;
  }

  const workspace = await findWorkspaceById(verification.workspaceId);
  if (!workspace) {
    return <ErrorPage message="This workspace could not be found. Please generate a new billing link from Slack." />;
  }

  const subscription = await findWorkspaceSubscription(workspace.id);
  if (!subscription) {
    return <ErrorPage message="This workspace doesn't have a billing subscription yet." />;
  }

  // POST-M11-B2 (corrected): re-check ownership fresh, right here — never
  // trust that the token was valid for the current owner just because it
  // verified. There is NO null-owner fallback: a subscription without a
  // recorded, validated owner has NO administrator authorized to manage
  // it — fail-closed, not "any admin may manage."
  if (computeBillingManagementAuthorization(subscription.billing_owner_user_id, verification.userId) !== "authorized") {
    return <ErrorPage message="This billing link is no longer valid. Please generate a new one from Slack." />;
  }

  let managementUrls;
  try {
    managementUrls = await createSubscriptionManagementUrls(subscription.provider_customer_id, subscription.provider_subscription_id);
  } catch (error) {
    console.error("Failed to create Paddle customer portal session:", error instanceof Error ? error.message : "unknown error");
    return <ErrorPage message="Billing management is temporarily unavailable. Please try again later." />;
  }

  if (!managementUrls) {
    // Fails closed: never falls back to another subscription's URL or the
    // ambiguous general customer-overview page (see the exact incident
    // this exists to prevent in select-subscription-management-urls.ts).
    console.error("Paddle did not return subscription-specific management URLs for this workspace's subscription.");
    return <ErrorPage message="Billing management is temporarily unavailable. Please try again later." />;
  }

  return (
    <main style={mainStyle}>
      <h1>ApproveGo Pro</h1>
      <p>$19 / month</p>
      <p>Manage your subscription.</p>
      <a href={managementUrls.updatePaymentMethod} style={primaryButtonStyle}>
        Update Payment Method
      </a>
      <a href={managementUrls.cancelSubscription} style={secondaryButtonStyle}>
        Cancel Subscription
      </a>
    </main>
  );
}
