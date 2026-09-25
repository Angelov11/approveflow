/**
 * Pure mirror of remove_workspace_admin()'s outcome logic — same pattern as
 * compute-decision-outcome.ts mirroring decide_on_request(). What this
 * function CANNOT mirror is the atomicity itself: the real guarantee against
 * the "Admin A removes B while Admin B removes A" race comes from the RPC's
 * `select ... from workspaces where id = $1 for update` lock serializing
 * concurrent transactions, which has no meaning outside a real database
 * transaction. This function exists purely as an exhaustively-tested
 * specification of the non-concurrent decision logic — given a consistent
 * snapshot of admins, what should happen.
 */

export type AdminRemovalOutcome = "removed" | "last_admin" | "not_admin" | "billing_owner_blocked";

/**
 * POST-M11-B2: `targetOwnsLiveSubscription` is a pre-resolved boolean —
 * "does the target currently own the workspace's active/trialing/
 * past_due/paused subscription" — computed by the caller (or, in the
 * real RPC, by a direct join), keeping this function's own logic a pure
 * decision over already-known facts, same as every other input here.
 * Checked AFTER last_admin, never before: last-admin protection must
 * never be weakened or bypassed by billing ownership — if removing this
 * user would leave zero admins, that's still the reason, regardless of
 * whether they also happen to own a subscription.
 */
export function computeAdminRemovalOutcome(
  currentAdminUserIds: readonly string[],
  targetUserId: string,
  targetOwnsLiveSubscription: boolean = false,
): AdminRemovalOutcome {
  if (!currentAdminUserIds.includes(targetUserId)) {
    return "not_admin";
  }
  if (currentAdminUserIds.length <= 1) {
    return "last_admin";
  }
  if (targetOwnsLiveSubscription) {
    return "billing_owner_blocked";
  }
  return "removed";
}
