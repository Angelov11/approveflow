import type { UsableWorkspace } from "./workspace-lookup.ts";
import type { Workspace } from "../../types/workspace.ts";

/**
 * Pure predicate behind getUsableInstallation() (workspace-lookup.ts) — kept
 * in its own module, with no `server-only`/database dependency, purely so
 * it's directly unit testable, matching this project's established split
 * between pure decision logic and the thin DB-touching wrapper around it
 * (see compute-decision-outcome.ts vs. approval-actions.ts).
 *
 * A workspace is "usable" only if its installation is currently INSTALLED
 * AND all three encrypted-token components are present — fails closed for
 * an unknown/uninstalled/token-revoked workspace, or a corrupt/partial
 * token row, identically.
 */
export function isUsableInstallation(workspace: Workspace | null): workspace is UsableWorkspace {
  if (!workspace) {
    return false;
  }
  if (workspace.installation_status !== "INSTALLED") {
    return false;
  }
  return Boolean(workspace.bot_access_token_ciphertext && workspace.bot_access_token_iv && workspace.bot_access_token_auth_tag);
}
