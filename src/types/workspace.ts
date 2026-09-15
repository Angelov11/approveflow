/** Row shape of the `workspaces` table (see supabase/migrations). */
export interface Workspace {
  id: string;
  slack_team_id: string;
  slack_enterprise_id: string | null;
  slack_app_id: string | null;
  name: string | null;
  domain: string | null;
  bot_user_id: string | null;
  /** Base64 AES-256-GCM ciphertext. Decrypt via src/lib/slack/token-encryption.ts — never read this column directly and log/return it. */
  bot_access_token_ciphertext: string;
  bot_access_token_iv: string;
  bot_access_token_auth_tag: string;
  installed_at: string;
  created_at: string;
  updated_at: string;
}
