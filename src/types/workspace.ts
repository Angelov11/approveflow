/** M8.1: Slack installation lifecycle state — see the migration adding installation_status for the full rationale. */
export type InstallationStatus = "INSTALLED" | "TOKEN_REVOKED" | "UNINSTALLED";

/** Row shape of the `workspaces` table (see supabase/migrations). */
export interface Workspace {
  id: string;
  slack_team_id: string;
  slack_enterprise_id: string | null;
  slack_app_id: string | null;
  name: string | null;
  domain: string | null;
  bot_user_id: string | null;
  /**
   * Base64 AES-256-GCM ciphertext. Decrypt via src/lib/slack/token-encryption.ts
   * — never read this column directly and log/return it. Nullable since
   * M8.1: cleared when installation_status is TOKEN_REVOKED or UNINSTALLED
   * (see events/route.ts). Always null/non-null together with the iv and
   * auth tag below — never independently null.
   */
  bot_access_token_ciphertext: string | null;
  bot_access_token_iv: string | null;
  bot_access_token_auth_tag: string | null;
  installation_status: InstallationStatus;
  /** Set only when transitioning into UNINSTALLED; null otherwise. Never reset by a redelivered app_uninstalled. */
  uninstalled_at: string | null;
  /** Most recent successful OAuth install/reinstall — NOT first-ever install (see the M8.1 migration for why first_installed_at was deliberately not added). */
  installed_at: string;
  created_at: string;
  updated_at: string;
}
