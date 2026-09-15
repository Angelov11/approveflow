-- Adds Slack OAuth installation data to workspaces (M1).
--
-- Slack client secret, signing secret, and the token encryption key are
-- application secrets and are never stored in this table or database — only
-- the AES-256-GCM-encrypted bot token (ciphertext + IV + auth tag) is
-- persisted here. See src/lib/crypto/token-cipher.ts for the encryption
-- scheme.
--
-- slack_team_id remains UNIQUE (set in the M0 migration): for this MVP a
-- Slack workspace corresponds to exactly one active installation, and
-- reinstalling upserts the existing row (on conflict on slack_team_id)
-- rather than creating a duplicate. Slack Enterprise Grid org-wide installs
-- (where a workspace-level team_id may be absent) are out of scope for M1
-- and would need a schema change to support.

alter table public.workspaces
  add column slack_enterprise_id text,
  add column slack_app_id text,
  add column bot_user_id text,
  add column bot_access_token_ciphertext text not null,
  add column bot_access_token_iv text not null,
  add column bot_access_token_auth_tag text not null;

comment on column public.workspaces.slack_enterprise_id is
  'Slack Enterprise Grid organization ID, when the install originates from an org. Null for standalone workspaces.';
comment on column public.workspaces.slack_app_id is
  'Slack app ID from the OAuth response, for reference/debugging.';
comment on column public.workspaces.bot_user_id is
  'Slack bot user ID associated with the granted bot token, when one was issued.';
comment on column public.workspaces.bot_access_token_ciphertext is
  'AES-256-GCM ciphertext (base64) of the Slack bot access token. Plaintext tokens are never stored.';
comment on column public.workspaces.bot_access_token_iv is
  'Base64-encoded random initialization vector used for this row''s AES-256-GCM encryption.';
comment on column public.workspaces.bot_access_token_auth_tag is
  'Base64-encoded AES-256-GCM authentication tag, checked on decrypt to detect tampering.';
