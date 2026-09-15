# ApproveFlow

ApproveFlow is a Slack-first approval and access-request application.
Slack users will submit requests (production access, deployment approval,
software access, purchase approval, custom approvals), approvers will
approve/reject them directly in Slack, and ApproveFlow will maintain an
audit trail. Later milestones may integrate with AWS, GitHub, Supabase
auth providers, and Google Workspace to automatically grant/revoke
temporary access.

## Current milestone: M1 — Slack Application Installation & OAuth

M0 set up the application skeleton (Next.js app, env config layer, Supabase
project structure, the `workspaces` table, health check, home page).

M1 adds the Slack installation flow: a workspace admin can click **Add to
Slack**, authorize ApproveFlow, get redirected back, and have the
installation (workspace + encrypted bot token) persisted.

**Still NOT implemented:** the `/request` slash command, any approval
workflow, Slack modals/interactions/events, App Home, user authentication,
billing, or third-party access provisioning (AWS/GitHub/etc.). Those belong
to M2 and later.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/) — only needed if you want to run the
  Supabase local stack (`supabase start`)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) —
  can also be run ad-hoc via `pnpm dlx supabase <command>` without a global
  install
- A Slack app — see [Slack app setup](#slack-app-setup) below

## Local setup

```bash
pnpm install
cp .env.example .env.local
# fill in .env.local — see Environment variables and Slack app setup below
pnpm dev
```

The app runs at http://localhost:3000.

## pnpm commands

| Command      | Description                          |
| ------------ | ------------------------------------- |
| `pnpm dev`   | Start the Next.js dev server          |
| `pnpm lint`  | Run ESLint                            |
| `pnpm test`  | Run unit tests (Node's built-in test runner) |
| `pnpm build` | Type-check and build for production   |
| `pnpm start` | Run the production build              |

## Environment variables

See `.env.example`. Copy it to `.env.local` for local development —
`.env.local` and all other `.env*` files (except `.env.example`) are
git-ignored and must never contain committed secrets.

| Variable                        | Exposure             | Purpose                                   |
| -------------------------------- | --------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`       | Public (browser)      | Supabase project URL                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Public (browser)      | Supabase anonymous/public API key          |
| `SUPABASE_SERVICE_ROLE_KEY`      | Server-only, secret   | Full-access Supabase key — never expose to client code |
| `NEXT_PUBLIC_APP_URL`            | Public (browser)      | Canonical app URL; used to build the Slack OAuth redirect URI |
| `SLACK_CLIENT_ID`                | Server-only           | Slack app's Client ID |
| `SLACK_CLIENT_SECRET`            | Server-only, secret   | Slack app's Client Secret — used to exchange the OAuth code |
| `SLACK_SIGNING_SECRET`           | Server-only, secret   | Not used yet (M1 has no code path that verifies inbound Slack requests) — reserved for M2 when events/interactions/slash-command endpoints are added |
| `SLACK_TOKEN_ENCRYPTION_KEY`     | Server-only, secret   | Base64-encoded 32-byte key encrypting bot tokens at rest (AES-256-GCM) |

`src/lib/env.ts` exposes the public variables, and `src/lib/env.server.ts`
(guarded by the `server-only` package) exposes every secret above. Any
attempt to import `env.server.ts`, `src/lib/supabase/admin.ts`,
`src/lib/slack/install-provider.ts`, or `src/lib/slack/token-encryption.ts`
from client component code will fail the build — the intended safeguard
against leaking secrets to the browser.

The health check endpoint (`/api/health`) does not read any of these
variables and works even if nothing else is configured.

## Slack app setup

Manual steps you need to perform in the Slack dashboard — nothing here is
automated.

1. Go to https://api.slack.com/apps and click **Create New App** → **From
   scratch**. Pick a name (e.g. "ApproveFlow") and your development
   workspace.
2. Open **OAuth & Permissions** in the sidebar:
   - Under **Redirect URLs**, add:
     - Local: `http://localhost:3000/api/slack/oauth/callback`
     - Production: `https://<your-vercel-domain>/api/slack/oauth/callback`
   - Under **Scopes → Bot Token Scopes**, add: `commands`
     (see [Slack scopes](#slack-scopes-requested) below for why — no other
     scopes are requested in M1)
3. Open **Basic Information** in the sidebar:
   - Under **App Credentials**, copy **Client ID** → `SLACK_CLIENT_ID`,
     **Client Secret** → `SLACK_CLIENT_SECRET`, and **Signing Secret** →
     `SLACK_SIGNING_SECRET`.
4. **Slash commands**: nothing to configure yet. The `/request` command
   (Features → Slash Commands) is an M2 task — M1 only requests the
   `commands` scope so the eventual command can be added without a second
   OAuth reinstall.
5. Generate the token encryption key on macOS:
   ```bash
   openssl rand -base64 32
   ```
   Put the output in `SLACK_TOKEN_ENCRYPTION_KEY`. It must decode to exactly
   32 bytes — the app validates this at startup and fails clearly if it
   doesn't.
6. Set `NEXT_PUBLIC_APP_URL` to match whichever redirect URL you're testing
   against (`http://localhost:3000` locally).

### Local-development callback considerations

Slack allows `http://localhost` (unlike other non-HTTPS hosts) as a
Redirect URL, so local OAuth testing works without a tunnel — just make
sure the port in `NEXT_PUBLIC_APP_URL` matches what `pnpm dev` is actually
running on. You do not need ngrok/a tunnel for M1, since nothing here
receives inbound webhooks from Slack yet (that starts in M2 with events and
slash commands).

### Production/Vercel callback considerations

- Set `NEXT_PUBLIC_APP_URL` (and every other env var above) in the Vercel
  project's Environment Variables settings — `.env.local` is never deployed.
- `NEXT_PUBLIC_APP_URL` must exactly match a Redirect URL registered in the
  Slack app, including scheme and absence/presence of a trailing slash.
- Vercel preview deployments get a unique URL per deployment, which won't
  match any registered Redirect URL. Test the OAuth flow against production
  (or a stable preview domain you've separately registered), not ad-hoc
  preview URLs.

### Slack scopes requested

| Scope | Type | Why |
| ----- | ---- | --- |
| `commands` | Bot | Required to receive the payload for the future `/request` slash command (M2). No bot scope is strictly required to complete installation alone, but Slack's OAuth v2 endpoint requires at least one bot scope to issue a bot token, so M1 requests the one scope already known to be needed next rather than something broader "just in case". |

No user scopes are requested. No scopes for messaging (`chat:write`),
reading users (`users:read`), interactivity, or events are requested — those
belong to M2+ when the corresponding features are actually built.

## Running locally

```bash
pnpm install
pnpm dev
```

Then visit:

- http://localhost:3000 — home page with an **Add to Slack** button
- http://localhost:3000/api/health — health check, returns
  `{"status":"ok","service":"approveflow"}`
- http://localhost:3000/api/slack/install — starts Slack OAuth (requires
  Slack env vars to be set; redirects to Slack)
- http://localhost:3000/slack/installed — installation result page (also
  the redirect target after a completed OAuth flow)

## Lint

```bash
pnpm lint
```

## Tests

```bash
pnpm test
```

Runs with Node's built-in test runner (`node --experimental-strip-types
--test`) — no test framework dependency required. Currently covers:

- `src/lib/crypto/token-cipher.test.ts` — AES-256-GCM encrypt/decrypt
  round-trip, random-IV uniqueness, invalid key length, tampered
  ciphertext/auth-tag rejection, wrong-key rejection.
- `src/lib/slack/state-secret.test.ts` — OAuth state-secret derivation is
  deterministic, input-sensitive, and distinct from the raw client secret.

These are unit tests only. The end-to-end OAuth flow (actually hitting
Slack and Supabase) has not been tested against real services — see the
verification notes in the M1 completion report.

## Build

```bash
pnpm build
```

## Supabase local development

This repo tracks the Supabase **project configuration and migrations only**
(`supabase/config.toml`, `supabase/migrations/`). No project has been
linked or pushed to a remote Supabase instance yet — see the M1 completion
report for the exact manual steps to create/link one.

To run Supabase locally (requires Docker):

```bash
pnpm dlx supabase start
```

This spins up a local Postgres instance and applies migrations from
`supabase/migrations/`. To create a new migration:

```bash
pnpm dlx supabase migration new <name>
```

Migrations so far:

- `*_create_workspaces.sql` (M0) — the `workspaces` table, keyed by unique
  `slack_team_id`.
- `*_add_slack_installation_to_workspaces.sql` (M1) — adds
  `slack_enterprise_id`, `slack_app_id`, `bot_user_id`, and the AES-256-GCM
  encrypted bot token columns (`bot_access_token_ciphertext`,
  `bot_access_token_iv`, `bot_access_token_auth_tag`). No Slack secrets are
  ever stored in this table — only the encrypted bot token.

## Project structure

```
src/
  app/
    api/
      health/route.ts              # GET /api/health
      slack/
        install/route.ts           # GET /api/slack/install — starts OAuth
        oauth/callback/route.ts    # GET /api/slack/oauth/callback
    slack/installed/page.tsx       # OAuth result page
    page.tsx                       # home page (Add to Slack button)
    layout.tsx
  lib/
    env.ts                        # public, client-safe env vars
    env.server.ts                 # server-only env vars (secrets)
    crypto/
      token-cipher.ts             # pure AES-256-GCM primitives (unit tested)
      token-cipher.test.ts
    slack/
      install-provider.ts         # server-only: Slack InstallProvider, scopes
      state-secret.ts             # pure: OAuth CSRF state-secret derivation
      state-secret.test.ts
      token-encryption.ts         # server-only: encrypt/decrypt bot tokens
    supabase/
      admin.ts                    # server-only: service-role Supabase client
  types/
    workspace.ts                  # Workspace row type

supabase/
  config.toml
  migrations/
    *_create_workspaces.sql
    *_add_slack_installation_to_workspaces.sql
```
