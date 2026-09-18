import "server-only";

import { getSupabaseAdmin } from "../supabase/admin.ts";
import type { NormalizedSubscriptionEvent } from "./paddle-webhook-normalization.ts";

export type ProcessPaddleSubscriptionEventOutcome =
  | "applied"
  | "duplicate_processed"
  | "ignored_missing_workspace"
  | "ignored_workspace_not_found"
  | "ignored_wrong_price"
  | "ignored_wrong_quantity"
  | "conflict_subscription_belongs_to_other_workspace"
  | "stale_event_ignored";

/**
 * Thin wrapper around the atomic `process_paddle_subscription_event` RPC —
 * see its migration header for the full algorithm/lock-ordering rationale.
 * Every outcome this returns represents a *permanent* decision the RPC
 * successfully reached — the route handler maps every one of them to
 * HTTP 200. A thrown error here (network/DB failure, or the RPC's own
 * programmer-error validation) means genuine processing failed and the
 * route handler must return a retryable 5xx instead.
 */
export async function processPaddleSubscriptionEvent(
  normalized: NormalizedSubscriptionEvent,
  expectedPriceId: string,
): Promise<ProcessPaddleSubscriptionEventOutcome> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("process_paddle_subscription_event", {
    p_provider: "PADDLE",
    p_provider_event_id: normalized.providerEventId,
    p_event_type: normalized.eventType,
    p_occurred_at: normalized.occurredAt,
    p_workspace_id: normalized.workspaceId,
    p_provider_subscription_id: normalized.providerSubscriptionId,
    p_provider_customer_id: normalized.providerCustomerId,
    p_provider_price_id: normalized.providerPriceId,
    p_quantity: normalized.quantity,
    p_expected_price_id: expectedPriceId,
    p_status: normalized.status,
    p_current_period_start: normalized.currentPeriodStart,
    p_current_period_end: normalized.currentPeriodEnd,
    p_scheduled_change_action: normalized.scheduledChangeAction,
    p_scheduled_change_effective_at: normalized.scheduledChangeEffectiveAt,
  });

  if (error) {
    throw new Error(`process_paddle_subscription_event failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.outcome) {
    throw new Error("process_paddle_subscription_event returned no result");
  }
  return row.outcome as ProcessPaddleSubscriptionEventOutcome;
}
