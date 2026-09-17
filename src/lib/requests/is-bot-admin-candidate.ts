/**
 * Pure predicate behind grantWorkspaceAdmin() — the workspace's own bot
 * account must never become an ApproveFlow admin, since it isn't a person.
 * Kept in its own module for the same reason as isUsableInstallation()
 * (installation-usability.ts): no `server-only`/database dependency, so
 * it's directly unit testable.
 */
export function isBotAdminCandidate(targetSlackUserId: string, workspaceBotUserId: string | null): boolean {
  return workspaceBotUserId !== null && targetSlackUserId === workspaceBotUserId;
}
