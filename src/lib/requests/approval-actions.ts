import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Decision, DecideOnRequestResult } from "@/types/approval";

/**
 * Thin wrapper around the `decide_on_request` Postgres function — all
 * authorization and atomicity live there (see the migration's header
 * comment for the concurrency argument this call relies on). This function
 * does no authorization itself; it only forwards already-resolved internal
 * IDs (never client-supplied values) and returns the outcome.
 */
export async function decideOnRequest(params: {
  requestId: string;
  approverId: string;
  decision: Decision;
}): Promise<DecideOnRequestResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("decide_on_request", {
    p_request_id: params.requestId,
    p_approver_id: params.approverId,
    p_decision: params.decision,
  });

  if (error) {
    throw new Error(`decide_on_request failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("decide_on_request returned no result");
  }
  return row as DecideOnRequestResult;
}
