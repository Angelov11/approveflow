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
