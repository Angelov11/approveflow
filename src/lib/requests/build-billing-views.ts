import type { ModalView } from "./build-admin-views.ts";

/**
 * Shown after a successful Upgrade click — a single external link out to
 * the ApproveGo billing-session URL. Slack opens `url` buttons client-side;
 * there is no action_id handling needed on our side for the click itself
 * (see interactions/route.ts's block_actions default "ignore safely"
 * branch), and Paddle Transaction creation happens only when that page
 * loads server-side — never here.
 */
export function buildBillingCheckoutModal(checkoutUrl: string): ModalView {
  return {
    type: "modal",
    title: { type: "plain_text", text: "Upgrade to Pro" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Continue in your browser to complete checkout for ApproveGo Pro — $19/month per workspace." },
      },
      {
        type: "actions",
        block_id: "billing_checkout_actions",
        elements: [{ type: "button", style: "primary", text: { type: "plain_text", text: "Continue to Checkout" }, url: checkoutUrl }],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "This link expires in 15 minutes." }],
      },
    ],
  } as ModalView;
}

/**
 * Shown after a successful Manage Billing click — a single external link
 * to /billing/manage, which redirects straight to the Paddle Customer
 * Portal server-side (see app/billing/manage/page.tsx). No Paddle API
 * call happens here — same trigger_id-safe pattern as the checkout modal.
 */
export function buildManageBillingModal(manageBillingUrl: string): ModalView {
  return {
    type: "modal",
    title: { type: "plain_text", text: "Manage Billing" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Continue in your browser to update your payment method or cancel your ApproveGo Pro subscription." },
      },
      {
        type: "actions",
        block_id: "manage_billing_actions",
        elements: [{ type: "button", style: "primary", text: { type: "plain_text", text: "Manage Billing" }, url: manageBillingUrl }],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "This link expires in 15 minutes." }],
      },
    ],
  } as ModalView;
}
