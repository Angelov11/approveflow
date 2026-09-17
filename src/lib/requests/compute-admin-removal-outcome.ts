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

export type AdminRemovalOutcome = "removed" | "last_admin" | "not_admin";

export function computeAdminRemovalOutcome(currentAdminUserIds: readonly string[], targetUserId: string): AdminRemovalOutcome {
  if (!currentAdminUserIds.includes(targetUserId)) {
    return "not_admin";
  }
  if (currentAdminUserIds.length <= 1) {
    return "last_admin";
  }
  return "removed";
}
