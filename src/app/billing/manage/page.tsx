import { redirect } from "next/navigation";

import { deriveBillingSessionSecret } from "@/lib/billing/billing-session-secret";
import { verifyBillingSessionToken } from "@/lib/billing/billing-session-token";
import { createCustomerPortalSession } from "@/lib/billing/create-customer-portal-session";
import { findWorkspaceSubscription } from "@/lib/billing/workspace-subscriptions";
import { serverEnv } from "@/lib/env.server";
import { findWorkspaceById } from "@/lib/requests/workspace-lookup";

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
 * Public route, same trust model as /billing/checkout — a verified signed
 * token is the only thing that authorizes this, never a session cookie.
 * Deliberately redirects immediately server-side rather than rendering an
 * intermediate page with a button: the Customer Portal session is
 * single-use and short-lived and shouldn't be shown/cached, and there's
 * no reason to make the admin click twice.
 */
export default async function BillingManagePage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const { session } = await searchParams;
  if (!session) {
    return <ErrorPage message="This billing link is invalid. Please generate a new one from Slack." />;
  }

  const secret = deriveBillingSessionSecret(serverEnv.SLACK_CLIENT_SECRET ?? "");
  const verification = verifyBillingSessionToken(session, secret);
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

  let portalUrl: string;
  try {
    portalUrl = await createCustomerPortalSession(subscription.provider_customer_id, subscription.provider_subscription_id);
  } catch (error) {
    console.error("Failed to create Paddle customer portal session:", error instanceof Error ? error.message : "unknown error");
    return <ErrorPage message="Billing management is temporarily unavailable. Please try again later." />;
  }

  redirect(portalUrl);
}
