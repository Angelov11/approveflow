# ApproveFlow

ApproveFlow is a Slack-first approval and access-request application.
Slack users will submit requests (production access, deployment approval,
software access, purchase approval, custom approvals), approvers will
approve/reject them directly in Slack, and ApproveFlow will maintain an
audit trail. Later milestones may integrate with AWS, GitHub, Supabase
auth providers, and Google Workspace to automatically grant/revoke
temporary access.

## Current milestone: M2 — `/request` and Request Creation

M0 set up the application skeleton. M1 added Slack OAuth installation with
encrypted bot-token storage.

M2 adds request creation: a workspace member runs `/request` in Slack,
ApproveFlow verifies the request genuinely came from Slack, opens a modal,
and a submitted request is persisted to Supabase with `PENDING` status.

**Still NOT implemented:** approvers, approval routing, Approve/Reject
buttons, approver DMs, App Home, automatic access provisioning
(AWS/GitHub/etc.), audit system, billing, a web dashboard, or user
authentication. Those belong to M3 and later.

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
| `SLACK_SIGNING_SECRET`           | Server-only, secret   | Verifies inbound Slack requests (slash command + interactions) — see [Slack request verification](#slack-request-verification) |
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

No user scopes are requested. M2 still does not request `chat:write` —
opening/closing the modal and showing field-level validation errors are
both done via the direct HTTP response to Slack's own requests, which
needs no extra scope. `users:read`, events, and other scopes remain
unrequested until a feature actually needs them.

## Slack request verification

Every request to `/api/slack/commands/request` and `/api/slack/interactions`
is verified using Slack's [signing secret protocol](https://docs.slack.dev/authentication/verifying-requests-from-slack)
before the body is parsed or trusted in any way:

1. Read the exact raw request body (`request.text()` — never parsed and
   re-serialized, since that can differ byte-for-byte from what Slack signed).
2. Read `X-Slack-Request-Timestamp` and `X-Slack-Signature`; reject if either is missing.
3. Reject if the timestamp is more than 5 minutes old (or in the future) — replay protection.
4. Compute `v0=` + `HMAC-SHA256(SLACK_SIGNING_SECRET, "v0:{timestamp}:{rawBody}")` and compare
   to the provided signature with `crypto.timingSafeEqual`.

This lives in `src/lib/slack/verify-request.ts` as a pure function (see
`verify-request.test.ts`) — no framework, no extra dependency, just Node's
built-in `crypto`. Only after this passes does either route parse the form
body / `payload` field.

## M2 Slack configuration: slash command and interactivity

Manual steps in the Slack app dashboard (same app created in
[Slack app setup](#slack-app-setup) above) — nothing here is automated, and
I have not modified your Slack app configuration myself.

1. **Features → Slash Commands** → **Create New Command**:
   - Command: `/request`
   - Request URL: `<APP_URL>/api/slack/commands/request`
   - Short description: whatever you'd like (e.g. "Submit an access/approval request")
2. **Features → Interactivity & Shortcuts**:
   - Turn Interactivity **On**
   - Request URL: `<APP_URL>/api/slack/interactions`
3. Bot Token Scopes (**OAuth & Permissions**) should already include
   `commands` from M1 — no new scope is needed for M2.
4. If you changed the Slash Command or Interactivity URL after already
   installing the app, **reinstall the app to the workspace** so Slack picks
   up the change (existing installations/tokens are unaffected — this repo's
   OAuth callback upserts by `slack_team_id`, so reinstalling updates the
   same row rather than duplicating it).

### Slack cannot call localhost — local development options

Both Request URLs above must be **publicly reachable HTTPS URLs**; Slack's
servers cannot reach `http://localhost:3000` directly (unlike the OAuth
Redirect URL, there's no localhost exception for slash commands/interactivity).
To develop locally you need a tunnel that forwards a public HTTPS URL to
your local `pnpm dev` server. I have not installed or configured a tunnel —
pick whichever you're comfortable with:

- [ngrok](https://ngrok.com/) — the most commonly used option for Slack app
  development; free tier gives a temporary public URL per run
  (`ngrok http 3000`). The URL changes on every restart unless you have a
  paid static domain, which means updating the two Request URLs in the
  Slack dashboard each time you restart the tunnel.
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared tunnel --url http://localhost:3000`) — free, no account required for a quick ad-hoc tunnel.
- A Vercel preview deployment — since this app already deploys cleanly to
  Vercel, pushing a branch and pointing Slack at the preview URL avoids a
  tunnel entirely, at the cost of a slower edit/test loop than local dev.

Whichever you choose, set `NEXT_PUBLIC_APP_URL` to that tunnel's HTTPS URL
while testing, and update the Slack Request URLs to match.

### Production/Vercel

Same considerations as OAuth in M1: set `NEXT_PUBLIC_APP_URL` to your real
Vercel domain, register the two Request URLs there, and be aware preview
deployments get unique URLs that won't match what's registered.

## Local vs. production architecture

Every M2 route is a stateless Next.js Route Handler: no persistent Node
server, no WebSockets, no background workers/queues. The slash command
route does its work (workspace lookup, user upsert, ensuring default
request types, decrypting the bot token, calling `views.open`) synchronously
within the single request/response cycle, because Slack requires an ack
within ~3 seconds and the `trigger_id` used to open a modal is itself only
valid for a few seconds — there's no opportunity (or need) to defer work to
a queue. This runs as-is on Vercel serverless functions with no
architectural changes between local and production.

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
- `POST /api/slack/commands/request` — the `/request` slash command target
  (requires a tunnel — see above — to actually receive traffic from Slack)
- `POST /api/slack/interactions` — modal submission target (same tunnel requirement)

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
- `src/lib/slack/verify-request.test.ts` — valid/invalid/missing signature,
  missing/stale/future timestamp, tampered body, malformed signature, wrong secret.
- `src/lib/requests/validate-request-submission.test.ts` — valid submission,
  unknown request type, malformed/unknown duration, empty resource/reason,
  oversized input, malformed private_metadata, multiple simultaneous errors.

These are unit tests only. Real Slack traffic (an actual `/request` invocation
and modal submission from Slack's servers) has not been tested — that
requires the Request URLs above to be configured against a publicly
reachable endpoint. See the verification notes in the M1/M2 completion reports.

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
- `*_enable_workspaces_rls.sql` (M2) — hardening fix: `workspaces` had row
  level security enabled by neither the M0 nor M1 migration, which meant
  the public anon key could read it. This enables RLS with no
  anon/authenticated policies; all app access goes through the service-role
  client, which bypasses RLS.
- `*_create_request_data_model.sql` (M2) — adds `users`, `request_types`,
  and `requests`, all workspace-scoped, all with RLS enabled and no
  anon/authenticated policies (same reasoning). See
  [RLS/security design](#database-security) below.

**Migrations have not been pushed to the linked remote project yet** — they
exist locally only. Run `pnpm dlx supabase db push` when you're ready to
apply them (or `pnpm dlx supabase start` to try them against a local
Postgres instance first, if Docker is running).

## Database security

`users`, `request_types`, and `requests` hold application data scoped to a
Slack workspace — none of it should be reachable by the public anon key.
All three (plus `workspaces`, retroactively) have RLS **enabled with zero
policies**. With RLS on and no policies, Postgres denies all access to the
`anon` and `authenticated` roles by default — only the service-role client
(`src/lib/supabase/admin.ts`, used exclusively by the two M2 routes) can
read or write these tables, since the service role bypasses RLS entirely.

This is a deliberate choice, not a placeholder: M2 has no user-facing
Supabase client anywhere (no browser code queries Supabase directly), so
there's nothing that currently needs an RLS policy. If a future milestone
adds a dashboard or any other client that queries Supabase directly with
the anon/authenticated key, add narrowly-scoped policies at that point —
don't open these tables by default.

## Project structure

```
src/
  app/
    api/
      health/route.ts              # GET /api/health
      slack/
        install/route.ts           # GET /api/slack/install — starts OAuth
        oauth/callback/route.ts    # GET /api/slack/oauth/callback
        commands/request/route.ts  # POST /api/slack/commands/request — /request slash command
        interactions/route.ts      # POST /api/slack/interactions — modal submission
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
      verify-request.ts           # pure: Slack request signature verification (unit tested)
      verify-request.test.ts
    requests/
      duration-options.ts         # pure: shared duration select options
      request-types.ts            # server-only: default request types + idempotent seeding
      workspace-lookup.ts         # server-only: workspace/user lookup+upsert
      build-request-modal.ts      # pure: Block Kit modal builder
      validate-request-submission.ts  # pure: view_submission validation (unit tested)
      validate-request-submission.test.ts
    supabase/
      admin.ts                    # server-only: service-role Supabase client
  types/
    workspace.ts                  # Workspace row type
    request.ts                    # User, RequestType, RequestRow types

supabase/
  config.toml
  migrations/
    *_create_workspaces.sql
    *_add_slack_installation_to_workspaces.sql
    *_enable_workspaces_rls.sql
    *_create_request_data_model.sql
```
