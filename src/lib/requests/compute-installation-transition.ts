import type { InstallationStatus } from "../../types/workspace.ts";

/**
 * Pure, exhaustively-tested specification of the workspace installation
 * lifecycle (M8.1) — mirrors the same "pure mirror of the real rule" pattern
 * already used for compute-decision-outcome.ts, but there is no SQL
 * counterpart here: unlike decide_on_request(), every writer of
 * installation_status is already-trusted, signature-verified, service-role
 * server code (see events/route.ts) — there is no RLS-bypass/anon-client
 * attack surface that would justify a SECURITY DEFINER RPC just to reuse
 * this logic from untrusted callers.
 *
 * `app_uninstalled` and `tokens_revoked` may arrive in either order, and
 * either may be redelivered by Slack's Events API retry mechanism — this
 * function must converge on the same safe end state regardless of order or
 * duplication. UNINSTALLED always wins as the final state: it is Slack's
 * unambiguous "the app is gone" signal, while `tokens_revoked` only proves
 * "our stored bot token is no longer valid," a narrower claim (see
 * events/route.ts for how a tokens_revoked payload is matched against our
 * stored bot_user_id before this function is ever called for that event).
 */

export type InstallationEvent = "app_uninstalled" | "tokens_revoked";

export interface InstallationTransitionInput {
  currentStatus: InstallationStatus;
  event: InstallationEvent;
}

export interface InstallationTransitionResult {
  nextStatus: InstallationStatus;
  /**
   * True only on the transition INTO 'UNINSTALLED' for the first time — a
   * redelivered app_uninstalled while already UNINSTALLED must never reset
   * uninstalled_at to "now" again.
   */
  shouldSetUninstalledAt: boolean;
  /**
   * True whenever the resulting state has no usable token — i.e. whenever
   * nextStatus !== 'INSTALLED'. Clearing an already-null token is a
   * harmless idempotent no-op, so this is simply "not INSTALLED", not a
   * separate case to track.
   */
  shouldClearToken: boolean;
}

export function computeInstallationTransition({ currentStatus, event }: InstallationTransitionInput): InstallationTransitionResult {
  if (event === "app_uninstalled") {
    // UNINSTALLED is terminal and idempotent: reachable from INSTALLED,
    // TOKEN_REVOKED, or (on redelivery) UNINSTALLED itself — always ends up
    // UNINSTALLED, only the first arrival sets the timestamp.
    return {
      nextStatus: "UNINSTALLED",
      shouldSetUninstalledAt: currentStatus !== "UNINSTALLED",
      shouldClearToken: true,
    };
  }

  // tokens_revoked — never regresses a more-final UNINSTALLED state
  // backward, and never touches uninstalled_at (that field means
  // specifically "we received app_uninstalled").
  if (currentStatus === "UNINSTALLED") {
    return { nextStatus: "UNINSTALLED", shouldSetUninstalledAt: false, shouldClearToken: true };
  }
  return { nextStatus: "TOKEN_REVOKED", shouldSetUninstalledAt: false, shouldClearToken: true };
}
