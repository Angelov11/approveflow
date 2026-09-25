/**
 * Pure decision behind handleManageBilling's and /billing/manage's own
 * pre-checks — same "pure decision behind a thin, untested DB/Slack
 * wrapper" split used throughout this project (see
 * compute-admin-removal-outcome.ts, compute-decision-open-behavior.ts).
 *
 * POST-M11-B2 (corrected): there is NO null-owner fallback. A
 * subscription without a recorded, validated owner has NO administrator
 * authorized to manage it — "no_owner" is a distinct, equally-denying
 * outcome from "not_owner", never treated as "any admin may manage."
 * This is intentionally fail-closed: the alternative (falling back to
 * "any admin") would let ANY admin manage a subscription whose owner was
 * deliberately dropped by the webhook's new-subscription-never-inherits
 * rule, which defeats the entire point of that rule.
 */
export type BillingManagementAuthorization = "authorized" | "no_owner" | "not_owner";

export function computeBillingManagementAuthorization(billingOwnerUserId: string | null, actingUserId: string): BillingManagementAuthorization {
  if (!billingOwnerUserId) {
    return "no_owner";
  }
  if (billingOwnerUserId !== actingUserId) {
    return "not_owner";
  }
  return "authorized";
}
