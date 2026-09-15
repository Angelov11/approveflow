# ApproveFlow

ApproveFlow is a Slack-first approval and access-request application.
Slack users will submit requests (production access, deployment approval,
software access, purchase approval, custom approvals), approvers will
approve/reject them directly in Slack, and ApproveFlow will maintain an
audit trail. Later milestones may integrate with AWS, GitHub, Supabase
auth providers, and Google Workspace to automatically grant/revoke
temporary access.

## Current milestone: M6 — Slack App Home

M6 adds a persistent **App Home** tab: a front door over the existing
product, not a second one. Opening the Home tab shows a short intro, a
**Create Request** button, an **Open Request Center** button, a "My
Requests" summary (your 3 most recent, since Home is a summary — the full
list is still `/requests`), and a "Waiting for Me" summary (a count + button,
or "Nothing is waiting for your approval." when there's nothing to decide).
Every one of those four actions reuses the exact M2–M5 modal
builders/queries/decision path unchanged — Home only adds a new entry point
and a new Slack Events API endpoint (`/api/slack/events`) that listens for
`app_home_opened` and republishes the tab. No web dashboard, no login, no
new Slack scopes, no database migration. See [M6: App Home
architecture](#m6-app-home-architecture) below.

## Previously: M5 — Slack Request History & Request Details

M5 added `/requests`: a way to see your ApproveFlow activity without leaving
Slack. Running it opens a modal with two sections — **My Requests** (what
you've submitted) and **Waiting for Me** (pending requests you're currently
authorized to decide). Opening any request shows its full details, and if
you're authorized, Approve/Reject right from there — using the exact same
`decide_on_request` atomic decision path as the DM-based buttons from M3/M4.
No web dashboard, no login, no new Slack scopes.

## Previously: M4 — Zero-Configuration Direct Approver Selection

M0 set up the application skeleton. M1 added Slack OAuth installation with
encrypted bot-token storage. M2 added `/request`: a workspace member submits
a request via a Slack modal, persisted with `PENDING` status. M3 added
approval policies: an admin configures who must approve each request type,
and ApproveFlow DMs them with Approve/Reject buttons.

**M4's product goal: ApproveFlow is now useful immediately after
installation, with no configuration step required.** Structured approvals
in Slack — request anything, pick an approver, get a decision in Slack:

1. Install ApproveFlow
2. Run `/request`
3. Fill in Request Type, Resource, Reason, Duration, and pick an **Approver**
4. Submit
5. The selected approver gets a Slack DM with Approve/Reject buttons
6. They decide — recorded atomically, same as M3

No admin setup is required for this default path. M3's approval policies
remain fully supported as an **optional, advanced** feature: if an admin
has configured an active policy for a request type (see [Approval policy
configuration](#approval-policy-configuration) below), ApproveFlow
automatically uses that policy instead of the manually selected approver.
Policy routing always takes precedence — a requester's pick can never
override configured company policy.

**Still NOT implemented:** a web admin dashboard, web authentication,
ADMIN/MEMBER roles, policy/request-type configuration UI, request
cancellation/editing, approval comments, rejection reasons, reminders,
escalations, scheduled jobs, email, billing, an audit event system,
automatic access provisioning/revocation (AWS/GitHub/etc.), AI, Home
personalization/settings, or an onboarding wizard.

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
   - Under **Scopes → Bot Token Scopes**, add: `commands` and `chat:write`
     (see [Slack scopes](#slack-scopes-requested) below for why)
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
| `commands` | Bot | Required to receive the payload for the `/request` slash command (M2). Slack's OAuth v2 endpoint requires at least one bot scope to issue a bot token at all, so M1 anchored on this one rather than something broader "just in case". |
| `chat:write` | Bot | M3: DMing each approver and updating that message after their decision (`chat.postMessage`/`chat.update`). |

**`chat:write` is the only scope M3 adds — `conversations.open` (and its
`im:write`/`mpim:write`/`channels:manage` scope requirements) is deliberately
NOT used.** Verified against Slack's current API reference (not assumed):
[`chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage)
documents that passing a user ID directly as the `channel` parameter opens a
DM automatically if one isn't already open, and lists `chat:write` as the
only scope that requires — `im:write` is not mentioned. So the app never
calls `conversations.open` at all; every approver DM and status update goes
through `chat.postMessage`/`chat.update` with the approver's Slack user ID
as `channel` (see `src/lib/requests/notify-approvers.ts`).

No user scopes are requested. `users:read` is still not requested —
approver mentions use stored `display_name` when available, otherwise a
`<@SLACK_USER_ID>` mention, which Slack resolves to a name/avatar
client-side with no extra scope needed (see
[User display names](#user-display-names) below).

**M4 adds no new scope at all.** The `/request` modal's new Approver field
uses Block Kit's native `users_select` element — Slack renders and
populates the picker itself from its own directory; this app never calls
an API to list workspace users. Checked directly against Slack's current
Block Kit reference before implementing: no scope is documented as
required for `users_select`, consistent with how `chat.postMessage`
already resolves a bare user ID into a DM with just `chat:write`. The
picker submits only a user ID (`selected_user` in the view_submission
payload) — never a name or profile — so there was never a `users:read`
dependency to begin with.

**Because this adds a new bot scope, you must reinstall the app** (visit
`/api/slack/install` again) for any workspace that was installed under M1/M2
— existing installations won't have `chat:write` on their token until they
reinstall. Reinstalling is safe: the OAuth callback upserts by
`slack_team_id`, so it updates the existing `workspaces` row (with the new
scope's token) rather than creating a duplicate.

**M6 adds no new scope either.** `views.publish` (used to render the App
Home tab) is documented as requiring no additional scope beyond what an
installed bot token already has — verified against Slack's current API
reference before implementing, the same way M4's `users_select` scope check
was done. The Events API subscription for `app_home_opened` is a Slack app
*configuration* change (Event Subscriptions → Subscribe to bot events), not
an OAuth scope, so it requires no reinstall — existing installations start
getting `app_home_opened` events as soon as the event is enabled on the app
and the Request URL is verified.

## Slack request verification

Every request to `/api/slack/commands/request`, `/api/slack/commands/requests`,
`/api/slack/interactions`, and `/api/slack/events` (M6) is verified using
Slack's [signing secret protocol](https://docs.slack.dev/authentication/verifying-requests-from-slack)
before the body is parsed or trusted in any way:

1. Read the exact raw request body (`request.text()` — never parsed and
   re-serialized, since that can differ byte-for-byte from what Slack signed).
2. Read `X-Slack-Request-Timestamp` and `X-Slack-Signature`; reject if either is missing.
3. Reject if the timestamp is more than 5 minutes old (or in the future) — replay protection.
4. Compute `v0=` + `HMAC-SHA256(SLACK_SIGNING_SECRET, "v0:{timestamp}:{rawBody}")` and compare
   to the provided signature with `crypto.timingSafeEqual`.

This lives in `src/lib/slack/verify-request.ts` as a pure function (see
`verify-request.test.ts`) — no framework, no extra dependency, just Node's
built-in `crypto`. Only after this passes does any route parse the form
body / `payload` field / event JSON. Confirmed against Slack's current docs
before building M6: the Events API uses this exact same v0 HMAC scheme, so
`isValidSlackRequest` is reused as-is for `/api/slack/events` — including
for the one-time `url_verification` handshake request, which Slack signs
like any other event. There is no unsigned bypass for that handshake.

## M2 Slack configuration: slash command and interactivity

Manual steps in the Slack app dashboard (same app created in
[Slack app setup](#slack-app-setup) above) — nothing here is automated, and
I have not modified your Slack app configuration myself.

1. **Features → Slash Commands** → **Create New Command**:
   - Command: `/request`
   - Request URL: `<APP_URL>/api/slack/commands/request`
   - Short description: whatever you'd like (e.g. "Submit an access/approval request")
2. **Features → Slash Commands** → **Create New Command** (M5):
   - Command: `/requests`
   - Request URL: `<APP_URL>/api/slack/commands/requests`
   - Short description: e.g. "View your ApproveFlow requests"
3. **Features → Interactivity & Shortcuts**:
   - Turn Interactivity **On**
   - Request URL: `<APP_URL>/api/slack/interactions` (same URL handles `/request` submissions, `/requests` navigation, and Approve/Reject — see [M5: /requests architecture](#m5-requests-architecture))
4. Bot Token Scopes (**OAuth & Permissions**) should already include
   `commands` and `chat:write` from M1/M3 — **no new scope is needed for M5**.
   Verified directly: `views.push`'s own reference documentation states
   "Scopes: No scopes required", and `views.open`/`views.update` are in the
   same family — modal operations are gated by the app having Interactivity
   enabled (step 3), not by an OAuth scope.
5. If you changed a Slash Command or the Interactivity URL after already
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

## M6 Slack configuration: App Home and Events API

Manual steps in the Slack app dashboard (same app as above) — nothing here
is automated, and I have not modified your Slack app configuration myself.

1. **Features → App Home**:
   - Turn **Home Tab** **On**.
   - Leave **Messages Tab** as-is (this app doesn't use it).
2. **Features → Event Subscriptions**:
   - Turn **Enable Events** **On**.
   - Request URL: `<APP_URL>/api/slack/events` — Slack will immediately send
     a `url_verification` request to this URL and expects the exact
     `challenge` value echoed back within a few seconds; the app only does
     this after verifying the request's signature (see [Slack request
     verification](#slack-request-verification) above), so make sure
     `SLACK_SIGNING_SECRET` is already set wherever this URL is reachable
     before you paste it in, or verification will fail and Slack will
     refuse to save the URL.
   - Under **Subscribe to bot events**, add `app_home_opened`.
   - Save.
3. Bot Token Scopes (**OAuth & Permissions**) should already include
   `commands` and `chat:write` from M1/M3 — **no new scope is needed for
   M6**. `views.publish`'s own reference documentation states no scope is
   required beyond an installed bot token, verified directly before
   implementing (same check as M2 did for `views.push`/`views.open`).
   Enabling Event Subscriptions and adding a bot event subscription is an
   app **configuration** change, not an OAuth grant, so **no reinstall is
   required** for existing installations — they start receiving
   `app_home_opened` events as soon as this is saved.
4. Same [tunnel requirement as M2](#slack-cannot-call-localhost--local-development-options)
   applies to the Events Request URL for local development — Slack cannot
   reach `http://localhost:3000` directly.

## Local vs. production architecture

Every route is a stateless Next.js Route Handler: no persistent Node
server, no WebSockets, no background workers/queues. The slash command
route does its work (workspace lookup, user upsert, ensuring default
request types, decrypting the bot token, calling `views.open`) synchronously
within the single request/response cycle, because Slack requires an ack
within ~3 seconds and the `trigger_id` used to open a modal is itself only
valid for a few seconds — there's no opportunity (or need) to defer work to
a queue. Sending approver DMs (M3) similarly happens inline, right after
the request is inserted, using `Promise.allSettled` so one approver's
delivery failure doesn't block or fail the others. This runs as-is on
Vercel serverless functions with no architectural changes between local and
production.

**M6's `/api/slack/events` follows the exact same synchronous pattern** —
no queue, no `waitUntil`/`after()`, nothing pretending background work is
durable when Vercel doesn't guarantee it. Handling `app_home_opened` is:
verify signature → 2 small indexed queries (3 most recent requests, 1
waiting-for-me count) → build the view → 1 `views.publish` call → ack. That
comfortably fits inside Slack's ~3-second ack window, same as every other
route in this app, so introducing a queue/worker for M6 would have been
unwarranted complexity for a read-mostly, deterministic query path. A
redelivered event (Slack retries on non-200/timeout) just republishes the
same Home view again — `views.publish` always replaces the previous view
wholesale, so a duplicate delivery is a harmless no-op, not a duplicate side
effect the way a second notification DM would be.

## Approval policy configuration (optional, M3)

**This is optional.** As of M4, ApproveFlow works with zero configuration —
requesters pick an approver directly in the modal. Configure a policy only
if you want a request type to always route to a fixed set of approvers
regardless of who submits it, or to require more than one approval.

There's no admin UI yet. Policies and their approvers are configured with a
one-off script run locally against your Supabase project — not an HTTP
endpoint, so there's nothing for an unauthenticated caller to hit:

```bash
node --experimental-strip-types --env-file=.env.local \
  scripts/configure-approval-policy.ts \
  --team T0123456 \
  --request-type production_access \
  --name "Production Access Approvers" \
  --required 2 \
  --approver U0111111 --approver U0222222
```

- `--team`: the Slack workspace's team ID (same value stored in `workspaces.slack_team_id`).
- `--request-type`: one of the 5 default keys (`production_access`,
  `deployment_approval`, `software_access`, `purchase_approval`, `custom`).
  These only exist once `/request` has been run at least once in that
  workspace (that's what seeds them) — run it once first if you get a "no
  request type" error.
- `--approver`: a Slack user ID, repeatable. Find one via a person's Slack
  profile → **⋯** → **Copy member ID**. This app has no scope to look users
  up by name.

Re-running the script for the same `--team`/`--request-type` updates the
existing policy in place (name, required approvals) and **replaces** its
member list with exactly what you passed — it's not additive. M3 enforces
at most one *active* policy per (workspace, request type) at the database
level (a partial unique index), so this script never creates a conflicting
second one.

To inspect state directly (no dashboard yet), query Supabase — e.g. via the
SQL editor or `curl` against `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/requests`
with the service role key — for `requests`, `approvals`,
`approval_policies`, and `approval_policy_members`.

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
- `src/lib/requests/validate-request-submission.test.ts` — valid submission
  (including the M4 approver field), unknown request type,
  malformed/unknown duration, empty resource/reason, oversized input,
  malformed private_metadata, missing/malformed approver selection,
  multiple simultaneous errors.
- `src/lib/requests/parse-block-action.test.ts` — valid Approve/Reject
  actions recognized from both a posted-message origin and a modal origin
  (M5), unknown action ignored, missing identifiers/malformed value
  rejected safely.
- `src/lib/requests/compute-decision-outcome.test.ts` — the approval
  state-machine for **both routing models**: policy-based (authorized
  approval, unauthorized approver, below-threshold stays PENDING, threshold
  transitions to APPROVED, immediate rejection, duplicate decision,
  decisions after APPROVED/REJECTED ignored, no-policy/missing-snapshot
  handling, single-approver policies) and direct (selected approver can
  approve/reject, a different user is denied, duplicate decision is safe,
  decisions after finalization are ignored), plus explicit routing-stability
  cases. See [Atomic approval design](#atomic-approval-design) for why this
  is a *pure mirror* of the real enforcement, not the enforcement itself.
- `src/lib/requests/build-requester-decision-notification.test.ts` — final-
  transition gating and attribution rules for the requester notification.
- `src/lib/slack/format-date.test.ts` — Slack date-token construction.
- `src/lib/requests/status-display.test.ts` — every status renders with
  both an emoji and a text label.
- `src/lib/requests/parse-requests-action.test.ts` (M5) — `view_request`/
  `view_waiting_requests` recognized, missing request id/trigger id/team/user
  rejected safely, unknown action ignored.
- `src/lib/requests/build-requests-views.test.ts` (M5) — My Requests and
  Waiting-for-Me empty states, the "showing N most recent" notice appears
  only when there's actually more, each row includes all 5 required fields,
  DIRECT pending vs. decided rendering, POLICY rendering with historical
  decisions *and* current pending members shown as distinct things, a
  decision from someone since removed from the policy still renders,
  historical null-policy routing renders the safe fallback message (never a
  fabricated approver), Approve/Reject only render when authorized, and
  nothing renders internal UUIDs/`routing_type` values/column names.

These are unit tests only — the pure Block Kit builders and payload
parsers, per this codebase's established approach (DB-touching server-only
modules like `request-views.ts` are verified by direct code review and live
testing against real data instead, same as every prior milestone's
server-only wrappers). Real Slack traffic has not been tested for M5 — that
requires the two Slash Command URLs and the Interactivity URL to be
configured against a publicly reachable endpoint. See the verification
notes in the M1–M5 completion reports.

## Atomic approval design

Authorizing and recording an Approve/Reject decision is NOT done in
application code — it's a single Postgres function,
`decide_on_request(request_id, approver_id, decision)`, called via
`supabase.rpc()` from `src/lib/requests/approval-actions.ts`. The function
row-locks the request (`select ... for update`) before checking anything, so
two near-simultaneous decisions on the same request (e.g. two approvers
clicking at once) serialize at the database level instead of racing on the
approval count — see the migration's header comment for the exact race this
prevents (two concurrent transactions each seeing only their own
not-yet-committed approval and neither ever reaching the threshold).

As of M4, the function branches on the request's own frozen
`routing_type` to decide HOW to authorize: for `POLICY` requests, the
approver must be a member of the snapshotted `approval_policy_id`; for
`DIRECT` requests, the approver must exactly equal `direct_approver_id`.
Both models share the same lock, the same duplicate-decision check, and the
same threshold/finalization logic (reading `required_approval_count` off
the request row itself, not a live policy lookup) — approvers never need to
know or care which routing model applies to the request they're deciding on.

`src/lib/requests/compute-decision-outcome.ts` is a pure TypeScript mirror
of the same algorithm, and it's what's actually unit tested (17 cases,
covering both routing models plus stability) — SQL can't run under Node's
test runner. It is a specification the SQL function is written to match,
reviewed for consistency, not a transactional guarantee in its own right;
re-implementing the count/update in JS would reintroduce the exact race the
DB-level lock exists to prevent. Keep both in sync if the algorithm ever
changes.

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
- `*_create_approval_schema.sql` (M3) — adds `approval_policies` (one active
  row per workspace/request-type, enforced via a partial unique index),
  `approval_policy_members`, and `approvals` (immutable: no update trigger,
  `unique(request_id, approver_id)`). RLS enabled, no anon/authenticated
  policies.
- `*_create_decide_on_request_function.sql` (M3) — the `decide_on_request()`
  function described in [Atomic approval design](#atomic-approval-design).
  Explicitly revokes the default Postgres `PUBLIC` execute grant and
  re-grants only to `service_role`.
- `*_add_direct_approver_routing_to_requests.sql` (M4) — adds `routing_type`,
  `approval_policy_id`, `direct_approver_id`, and `required_approval_count`
  to `requests`, backfills existing rows, and adds a CHECK constraint
  preventing contradictory routing states. See
  [Routing stability / policy snapshot design](#routing-stability--policy-snapshot-design).
- `*_update_decide_on_request_for_direct_routing.sql` (M4) — `create or
  replace`s `decide_on_request()` (the M3 migration that first created it is
  untouched) so it authorizes both POLICY and DIRECT routed requests. Same
  grants re-asserted (service_role only).

**M4's two new migrations have not been pushed to the linked remote project
yet** — they exist locally only, same as every prior milestone's migrations
were before you pushed them. Run `pnpm dlx supabase db push` when you're
ready to apply them (or `pnpm dlx supabase start` against a local Postgres
instance first, if Docker is running). I did not run this myself.

## Database security

`users`, `request_types`, `requests`, `approval_policies`,
`approval_policy_members`, and `approvals` hold application data scoped to a
Slack workspace — none of it should be reachable by the public anon key.
All of them (plus `workspaces`, retroactively) have RLS **enabled with zero
policies**. With RLS on and no policies, Postgres denies all access to the
`anon` and `authenticated` roles by default — only the service-role client
(`src/lib/supabase/admin.ts`) or the `decide_on_request()` function can read
or write these tables.

This is a deliberate choice, not a placeholder: there is no user-facing
Supabase client anywhere in this app (no browser code queries Supabase
directly), so there's nothing that currently needs an RLS policy. If a
future milestone adds a dashboard or any other client that queries Supabase
directly with the anon/authenticated key, add narrowly-scoped policies at
that point — don't open these tables by default.

### `decide_on_request()` function privileges

Postgres grants `EXECUTE` on newly created functions to `PUBLIC` by
default — that default was not assumed safe. The migration explicitly
`REVOKE`s it (and from `anon`/`authenticated` individually, for clarity) and
grants `EXECUTE` only to `service_role`, the only role that ever calls it
(`src/lib/requests/approval-actions.ts`, itself only called from
server-side routes). The function is `SECURITY DEFINER` with
`SET search_path = pg_catalog, public` pinned explicitly, which forecloses
a search-path-hijacking attack (the classic risk with `SECURITY DEFINER`
functions that don't pin their search path). All authorization inside the
function operates on internal UUIDs already resolved server-side from the
trusted, signature-verified Slack payload — it never receives or trusts a
client-supplied workspace/user identifier directly.

## Routing: policy vs. direct (M4)

Every request is routed exactly once, at creation, in
`src/app/api/slack/interactions/route.ts`:

1. The requester always picks an **Approver** in the modal (required —
   see [Modal validation compromise](#modal-validation-compromise) below).
2. The interactions route checks whether an *active* approval policy
   exists for the selected request type
   (`src/lib/requests/approval-policies.ts`).
3. **Policy exists → POLICY routing.** The request is governed by that
   policy; the requester's manually selected approver is resolved (so it's
   confirmed to be a real workspace user) but is **not** persisted as the
   request's approver — company policy always wins, and a requester can
   never route around it by picking someone outside the policy.
4. **No active policy → DIRECT routing.** The request's approver is
   exactly the person the requester selected, and exactly **1** approval
   is required — no multi-approver direct routing in M4 (that's still only
   available via M3 policies).

A request is never left unroutable: M3's old "no policy → PENDING forever
with nobody notified" behavior no longer exists as a reachable state under
normal use, since the modal always collects a fallback approver. It only
occurs now if a submission is malformed/forged in a way that bypasses the
required Approver field — validated server-side regardless (see
[Modal validation compromise](#modal-validation-compromise)).

### Routing stability / policy snapshot design

A request's routing must not change after the fact just because policies
changed later — see the migration adding `routing_type`,
`approval_policy_id`, `direct_approver_id`, and `required_approval_count`
to `requests` for the full design rationale. Summary:

- **`routing_type`** and **`approval_policy_id`** are frozen at creation —
  `decide_on_request()` never re-asks "is there an active policy right
  now"; a request created under Policy A stays governed by Policy A even
  if it's later disabled and replaced by Policy B for the same request type.
- **`required_approval_count`** is also frozen at creation (snapshotted
  from the policy's `required_approvals`, or always `1` for DIRECT) — so
  editing a policy's threshold later doesn't retroactively change the
  requirement for requests already in flight.
- **Policy *membership* is deliberately NOT frozen** — a POLICY request's
  authorization always reads `approval_policy_members` live via the
  snapshotted `approval_policy_id`. This is an intentional asymmetry: policy
  *identity* and *threshold* are frozen for routing stability, but *who* can
  currently act under that policy stays live, because immediately revoking
  someone's approval rights (e.g. they left the team) is the safer default
  than honoring a stale membership snapshot for requests still pending.

### Modal validation compromise

The Approver field is shown and required for every request type, even
though a POLICY-routed submission ends up discarding the selection — the
modal can't know client-side whether a policy exists for the currently
selected request type without dynamic modal mutation, which M4 deliberately
doesn't implement (kept out of scope to avoid "complicated live modal
mutation"). The field's hint text ("Used when no approval policy is
configured for this request type.") sets that expectation for the
requester. If no policy exists and no valid approver was submitted anyway
(a forged/malformed submission, since Slack's own UI won't allow an empty
required field under normal use), the interactions route rejects it with a
field-level error rather than creating an unroutable request.

## Notification/decision delivery failures

Database state is authoritative; Slack API calls are always best-effort
follow-ups, never a condition for correctness:

- If sending an approver DM fails (`notify-approvers.ts`), it's logged
  (sanitized: `error.message` only, never a token or full API response) and
  the other approvers are still notified — one failure doesn't cancel the
  rest, and the already-created `PENDING` request is untouched either way.
- If recording a decision (`decide_on_request` RPC) fails, the interactions
  route logs it and acknowledges Slack with an empty 200 without touching
  the request — no partial state, since the whole decision is one
  transaction that either commits entirely or not at all.
- If updating the Slack message after a successful decision fails (e.g. a
  transient API error), the decision itself is unaffected — it was already
  committed before the update was attempted. The approver's message may
  keep showing stale buttons in that case; clicking them again is safe
  (`decide_on_request` returns `already_decided`, not a second approval).

M3 does not queue or retry failed Slack calls — this is a documented
limitation, not an oversight, per the instruction not to introduce a queue
unless absolutely necessary. A future milestone could add retries if this
becomes a real problem in practice.

## Multi-approver behavior

With `required_approvals = 2` and members Gary + Mike: both are DMed when
the request is created. Gary approving alone leaves the request `PENDING`
(Gary's own message updates to "🟡 Your approval was recorded. Waiting for
1 more approval."). Mike approving next transitions it to `APPROVED` (Mike's
message shows "✅ Request approved."). If either rejects at any point before
the request is final, it becomes `REJECTED` immediately regardless of prior
approvals. Only the *clicking* approver's own DM is updated at the moment
of their click — M3 does not proactively push an update to other approvers'
copies of the message when a *different* approver's click finalizes the
request (that would need storing every approver's channel/message
reference and fanning out extra Slack calls, which isn't implemented). If
an approver with a stale-looking message clicks it after the fact, the RPC
safely returns `already_final` and their message is updated to reflect the
real final status — no double-decision, just a slightly delayed reconciliation.

## User display names

`users.display_name` is never populated automatically (no `users:read`
scope is requested, and M3 doesn't add one just for this). Approver/requester
mentions in Slack messages use `display_name` when set, otherwise fall back
to `<@SLACK_USER_ID>` — Slack renders that as a proper name/avatar mention
client-side regardless, so the fallback looks correct without needing any
additional scope. See `formatUserMention()` in
`src/lib/requests/build-approval-notification.ts`.

## M5: /requests architecture

### Navigation UX

Slack modals don't have native tabs, so rather than build a custom
tab-switching framework, `/requests` opens **one modal** ("Request Center")
with both sections stacked:

- **My Requests** is shown inline (up to 10, newest first) since it's
  purely informational.
- **Waiting for Me** is shown as a summary line + a button
  ("`N` requests need your decision" → **View waiting requests**), since
  those entries need Approve/Reject affordances that would clutter the main
  view. Clicking it `views.push`es a dedicated "Waiting for Me" list.

Opening any request (from either list) `views.push`es a "Request Details"
view. Slack automatically shows a back-arrow in the modal header once
you've pushed a view — no custom "Back" button needed. Every pushed view's
**Close** button closes the whole stack, which is the simplest correct
behavior for M5 (no partial-stack-close requirement exists).

```
/requests
  → Request Center (My Requests inline + Waiting-for-me summary)
      → [View] on a My-Requests row       → Request Details (read-only unless also authorized)
      → [View waiting requests]           → Waiting for Me list
          → [View] on a waiting row       → Request Details (with Approve/Reject)
```

### Reusing the M3/M4 decision path — not a second implementation

Approve/Reject buttons inside the Request Details modal use the **exact
same** `approve_request`/`reject_request` action IDs and the exact same
`decide_on_request()` call (`src/lib/requests/approval-actions.ts`,
unchanged) as the DM-based buttons from M3/M4. The only thing that differs
by origin is how the outcome is *reflected*: a DM message gets
`chat.update`d (unchanged M3/M4 behavior); a modal gets `views.update`d
with a freshly-rebuilt Request Details view. `src/lib/requests/parse-block-
action.ts` was extended (not duplicated) to recognize both origins — Slack
sends `channel`/`message` for a posted-message click and `view` instead for
a modal click, so the parser returns a `source: {type: "message", ...} |
{type: "modal", ...}` discriminator that the interactions route branches
on only for the reflection step, never for authorization.

### Stale-modal handling

Because the reflection step always re-runs `decide_on_request()` first and
then re-fetches fresh request details before rebuilding the view, every
scenario in the M5 spec resolves correctly without any client-side
correctness assumption:

- **Someone else finalizes it first, then you click Approve**: the RPC
  returns `already_final`; the modal updates to show the real current
  status via a banner, no second decision is recorded.
- **You're removed from the policy, then you click Approve**: the RPC
  returns `unauthorized`; the modal shows "You're not authorized to decide
  on this request." — the click never touches the database.

Database state is authoritative in both cases — the UI only ever *reports*
what the RPC decided, never assumes it.

### Database query design

Three focused, workspace-scoped queries in `src/lib/requests/request-views.ts`:

- **`listRequestsByRequester(workspaceId, requesterId)`** — always filters
  by both `workspace_id` and `requester_id` together (never one alone),
  newest-first, capped at 10 with an exact `count` fetched in the same
  query so the "showing your 10 most recent" notice only appears when
  there's actually more.
- **`listRequestsWaitingForApprover(workspaceId, userId)`** — the
  security-sensitive one. Computed with a small, fixed number of targeted
  queries (not fetched-then-filtered-in-JS): DIRECT candidates
  (`direct_approver_id = userId`), then the user's policy memberships, then
  PENDING POLICY requests for those policy IDs, then that user's own
  `approvals` for exactly those candidate IDs — filtered out in one pass.
  A policy member who has already decided is correctly excluded (matches
  `decide_on_request`'s own `already_decided` rule, read-side); a
  historical request with a null `approval_policy_id` can never match any
  real policy ID, so it's excluded by construction, no special-case needed.
- **`getRequestDetails(workspaceId, requestId, viewerUserId)`** — requires
  `request.workspace_id = workspaceId` **and** `request.id = requestId`
  together; returns `null` (not an error) for a request that doesn't exist
  *or* belongs to a different workspace, so a caller can never distinguish
  "wrong workspace" from "doesn't exist" by probing UUIDs.

### Decision history vs. current authorization

Per the M4 design, policy *membership* is intentionally live — so
`getRequestDetails` renders these as two different things: every row ever
written to `approvals` is shown (a decision from someone since removed
from the policy is never erased), while "who's still pending" is computed
fresh from *current* `approval_policy_members` minus whoever's already
decided. Removing someone from a policy immediately stops them appearing
as "pending" on requests they hadn't yet decided, without touching the
historical record of decisions they already made.

### Human-readable output, not database language

Request Details never shows a UUID, `routing_type` value, or column name —
`src/lib/requests/build-requests-views.ts`'s `RequestRoutingView` type
speaks only in "Approver: `<@id>`" / "Approval policy: `<name>`" /
"Approval routing unavailable for this historical request." (the M4
null-`approval_policy_id` case — never a fabricated policy/approver).
Request type names come from `request_types.name` (already the
authoritative display label from M2 — no hardcoded key→label map).
Timestamps use Slack's `<!date^...>` token so each viewer sees their own
timezone, with a plain-text fallback.

## M6: App Home architecture

### Why an Events API endpoint, not a slash command

Home is *pushed* to a user by Slack whenever they open the tab — it isn't
requested via a command, so it needs an endpoint that receives Slack Events
API callbacks. This is a genuinely new Slack surface (M1–M5 only ever used
slash commands and interactivity), so it lives in its own route,
`/api/slack/events`, rather than being folded into `/api/slack/interactions`
— the two payload shapes (`event_callback` envelopes vs. `block_actions`/
`view_submission` payloads) are unrelated, and mixing them would make one
handler do two jobs.

### The event envelope and `url_verification`

Slack's Events API wraps every delivery in an outer envelope:
`{type: "url_verification", challenge, token}` once, when you first save the
Request URL, or `{type: "event_callback", team_id, event: {...}, ...}` for
every real event after that. `src/lib/slack/parse-slack-event.ts` is a pure
classifier (unit tested) that turns a signature-verified envelope into
exactly one of three outcomes: `url_verification` (echo the challenge back),
`app_home_opened` (only when `event.tab === "home"` — a `messages` tab open
is a different event value on the same event type and must **never**
republish Home), or `ignored` (any other event type, or a malformed/
incomplete envelope) — never throws.

### `app_home_opened` handling

For an accepted `app_home_opened`, `/api/slack/events`:

1. Resolves the workspace via `findWorkspaceBySlackTeamId(team_id)` — if
   `null` (uninstalled, or an event for a team this app has never seen),
   acks with 200 and does nothing else. There's nothing to publish to, and
   returning non-200 would just cause Slack to retry a request that can
   never succeed.
2. Upserts the Slack user (`upsertSlackUser`, the same idempotent M2
   helper every other route uses) — Home must work for a user who has never
   run a command before.
3. Runs `listRequestsByRequester(workspace.id, viewer.id, 3)` and
   `listRequestsWaitingForApprover(workspace.id, viewer.id)` in parallel —
   the **exact same M5 functions**, just called with a smaller limit for the
   first one (see below).
4. Builds the view with `buildAppHomeView` and publishes it with
   `client.views.publish({ user_id, view })`.
5. Any failure past step 1 is caught, logged (message only — never the bot
   token or raw API response), and still acks 200, matching every other
   route's error-handling convention in this app.

### Reusing M5's queries, not re-deriving them

`listRequestsByRequester` (`src/lib/requests/request-views.ts`) gained one
new optional parameter: `limit`, defaulting to the existing M5 constant
(`10`) so `/requests`'s behavior is completely unchanged. Home passes `3`.
The scoping (`workspace_id` **and** `requester_id` together, newest-first)
and the query shape are identical either way — this is the same function,
not a second one. `listRequestsWaitingForApprover` needed **no changes at
all**: Home's "Waiting for Me" count is just `waitingRequests.length` from
the same DIRECT/POLICY live-membership-aware query M5 already uses, so a
policy member who's already decided, or been removed from a policy, is
excluded from Home's count exactly as they are from the Request Center's.

### The four Home actions — reuse, not a second system

| Home action | Action ID | Reuses |
| --- | --- | --- |
| **Create Request** | `create_request_home` (new) | `ensureDefaultRequestTypes` + `listActiveRequestTypes` + `buildRequestModal` — identical bootstrap to `/request`, including a freshly generated `idempotencyKey` |
| **Open Request Center** | `open_request_center` (new) | `listRequestsByRequester` (default limit 10) + `listRequestsWaitingForApprover` + `buildRequestCenterView` — identical to `/requests` |
| **View** (a My Requests row) | `view_request` (M5, unchanged) | `getRequestDetails` + `buildRequestDetailsView` |
| **View pending approvals** | `view_waiting_requests` (M5, unchanged) | `listRequestsWaitingForApprover` + `buildWaitingListView` |

The last two are the *same* action IDs and the *same* buttons M5 already
renders inside the Request Center modal — Home's "My Requests" rows are
built with the same exported `buildRequestRowBlocks` helper
(`build-requests-views.ts`), so a click behaves identically no matter which
surface it came from.

### `views.open` vs. `views.push` — the one real behavioral difference

A Home tab is never part of a modal's view stack, so a Home-originated
button click has no open modal to push onto — it must call `views.open` to
create a brand-new one. The *same* `view_request`/`view_waiting_requests`
buttons clicked from inside an already-open Request Center modal (M5) still
need `views.push`, unchanged. `parse-requests-action.ts` distinguishes the
two by reading `payload.view?.type` off the `block_actions` payload — Slack
sets this to `"home"` for a Home tab click and `"modal"` for a click inside
an open modal — and returns an `origin: "home" | "modal"` field the
interactions route branches on for exactly this one API choice. The
query/view-building code path is 100% shared; only the final Slack Web API
call differs.

### Home refresh after an action

Home is **not** proactively republished after a Home-launched action (e.g.
after creating a request via the Home button, or after deciding on a
request opened from Home). Slack already re-fires `app_home_opened`
whenever a user reopens/refocuses the Home tab, which naturally reflects
the new state on next view — implementing an explicit re-publish would mean
guessing which of several nested modal actions should trigger it and
manufacturing a `user_id`-targeted `views.publish` call outside the normal
event flow, for a freshness gap of at most a few seconds. Documented here
as a deliberate scope decision, not an oversight.

### Security

- Every Home action re-resolves `workspace`/`viewer` from the
  signature-verified payload's own `team.id`/`user.id` — never from a
  client-supplied value, exactly like every other M2–M5 interaction.
- `create_request_home`/`open_request_center` carry no request identifier at
  all, so there's nothing to validate beyond the standard identifier checks.
- `view_request` clicked from Home still passes only an opaque `requestId`
  in the button value; `getRequestDetails` still requires
  `workspace_id = workspace.id` **and** `id = requestId` together, so
  cross-workspace access still fails safely (returns `null` → a generic
  "not found" view, not an error leaking which workspace the ID belongs to).
- No new database migration, no new RLS policy, no new authorization model —
  M6 introduces zero new ways to read or write a `requests` row.

## M4 end-to-end testing procedure

Both tests need: migrations pushed (`pnpm dlx supabase db push`, not run by
me), and the Slack app reinstalled if it hasn't already picked up
`chat:write` from M3.

### Test A — zero configuration (no policy)

Use a request type with **no** active policy (`deployment_approval`,
`software_access`, `purchase_approval`, or `custom` — assuming you haven't
configured a policy for any of them).

1. Run `/request` in Slack.
2. Select that request type, fill in Resource/Reason/Duration.
3. In **Approver**, select a *different* Slack user (a colleague, or a
   second test account).
4. Submit.
5. That selected user should receive a DM with the request details and
   Approve/Reject buttons — no policy configuration needed anywhere.
6. Have them click **Approve** — their message should update to
   "✅ Request approved.", and the `requests` row's `status` should be
   `APPROVED`, `routing_type` = `DIRECT`, `direct_approver_id` = their
   internal user id, `required_approval_count` = `1`.
7. Repeat with a fresh `/request`, same approver, click **Reject** instead
   — should transition straight to `REJECTED`.

### Test B — existing policy takes precedence

Use `production_access`, which already has an active M3 policy configured
in this workspace (single approver, `required_approvals = 1`).

1. Run `/request`, select **Production Access**.
2. In **Approver**, deliberately select someone who is **not** the
   configured policy member.
3. Submit.
4. Verify in Supabase: the new request's `routing_type` = `POLICY`,
   `approval_policy_id` is set, `direct_approver_id` is **null** — the
   manually selected person was never persisted as the approver.
5. Verify only the actual policy member(s) received the DM — not the
   person selected in the modal.
6. If the person selected in the modal (who is not a policy member)
   somehow tried to click Approve on some other message, `decide_on_request`
   must return `unauthorized` and the request must remain `PENDING` —
   selection in the modal must never itself grant authorization.
7. Have the real policy member approve — should behave exactly as in M3
   (atomic transition to `APPROVED`, single `approvals` row).

## M5 end-to-end testing procedure

Needs: the two new Slash Command/Interactivity URL entries added in
[M2 Slack configuration](#m2-slack-configuration-slash-command-and-interactivity)
(the `/requests` command specifically), and at least one existing DIRECT
and one existing POLICY request in the workspace (from prior M4 testing).

### Test A — My Requests

Run `/requests` from an account that has submitted several requests.

- Recent requests appear, newest first, both DIRECT and POLICY ones, with
  statuses matching production.
- Open one DIRECT request → correct resource/reason/duration/status, the
  selected approver shown, and the recorded decision (or "pending") shown.
- Open one POLICY request → the policy name shown, historical decision(s) shown.

### Test B — Waiting for Me

1. Create a new DIRECT request assigned to another account.
2. On that approver's account, run `/requests` → the request should appear
   in Waiting for Me.
3. Open it → Approve/Reject should be available.
4. Approve it → it should disappear from that account's Waiting for Me,
   the requester should receive the final notification (M4 behavior,
   unchanged), and it should show `APPROVED` in the requester's My Requests.

### Test C — Policy request

1. Create a Production Access request.
2. On the configured policy approver's account, run `/requests` → the
   request should appear in Waiting for Me.
3. On the account that was manually selected in the modal (but is **not**
   a policy member), run `/requests` → the request should **not** appear
   in Waiting for Me.
4. Have the configured approver decide → normal M4 behavior (requester
   notified, request removed from Waiting for Me for that approver).

## M6 end-to-end testing procedure

Needs: App Home + Event Subscriptions enabled per [M6 Slack
configuration](#m6-slack-configuration-app-home-and-events-api) above, the
Request URL verified, and at least one existing DIRECT and one existing
POLICY request in the workspace (from prior M4/M5 testing).

### Test A — first open, empty state

On an account that has never submitted a request and has nothing pending:
open the **Home** tab in the ApproveFlow app.

- Intro/tagline, **Create Request**, and **Open Request Center** buttons
  render.
- My Requests shows "You haven't submitted any requests yet."
- Waiting for Me shows "Nothing is waiting for your approval." — no button.

### Test B — My Requests summary (capped at 3)

On an account with more than 3 requests submitted: open Home.

- Exactly the 3 most recent appear (never more), newest first, correct
  statuses.
- Compare against `/requests` on the same account — the same 3 requests
  (by id/status/resource) should be the top 3 there too.

### Test C — Waiting for Me summary

1. Create a new DIRECT request assigned to another account.
2. On that approver's account, open Home → "Waiting for Me" shows a count of
   at least 1 and a **View pending approvals** button.
3. Click it → the same Waiting for Me list `/requests` would show, with
   Approve/Reject available on the request.
4. Approve it → re-open Home on that account → the count decreases
   (eventually to 0, showing the empty-state message again once nothing is
   left).

### Test D — Create Request from Home

1. Click **Create Request** on Home.
2. The exact same "New Request" modal as `/request` opens (same fields:
   Request Type, Resource, Reason, Duration, Approver).
3. Submit with no active policy for the chosen type → the selected approver
   gets a DM, identical to the `/request` flow (M4 Test A).
4. Submit for a request type with an active policy → policy routing takes
   precedence, identical to the `/request` flow (M4 Test B) — the manually
   selected approver is never persisted as the approver.

### Test E — Open Request Center from Home

1. Click **Open Request Center** on Home.
2. The exact same Request Center modal `/requests` opens — full My Requests
   list (up to 10) and Waiting for Me summary.
3. From inside it, click **View** on a row → pushes Request Details onto the
   *same* modal (back arrow appears) — this is the unchanged M5 `views.push`
   path, not `views.open`, since this click originates from inside an
   already-open modal, not from Home.

### Test F — cross-workspace / uninstalled safety

1. If you have a second ApproveFlow-installed workspace, open Home there —
   its data must be completely independent (no bleed-through of the first
   workspace's requests/counts).
2. Manually send a `url_verification` request with a correct signature but
   for the wrong signing secret (or a stale timestamp) → must receive `401`,
   never an echoed challenge.
3. (Optional, destructive — only if you have a disposable test workspace)
   Uninstall the app, then trigger `app_home_opened` for that team (e.g. by
   an admin reinstalling and immediately opening Home, or by inspecting
   server logs after an uninstall) → the endpoint must ack 200 without
   error, never a 500.

## Project structure

```
src/
  app/
    api/
      health/route.ts              # GET /api/health
      slack/
        install/route.ts           # GET /api/slack/install — starts OAuth
        oauth/callback/route.ts    # GET /api/slack/oauth/callback
        commands/
          request/route.ts         # POST /api/slack/commands/request — /request slash command
          requests/route.ts        # POST /api/slack/commands/requests — /requests slash command (M5)
        events/route.ts            # POST /api/slack/events — Events API: url_verification + app_home_opened (M6)
        interactions/route.ts      # POST /api/slack/interactions — modal submissions, Approve/Reject, /requests + Home navigation
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
      format-date.ts              # pure (M5): Slack date-token formatting (unit tested)
      format-date.test.ts
      parse-slack-event.ts        # pure (M6): Events API envelope classifier — url_verification / app_home_opened / ignored (unit tested)
      parse-slack-event.test.ts
    requests/
      duration-options.ts         # pure: shared duration select options + labels
      request-types.ts            # server-only: default request types + idempotent seeding
      workspace-lookup.ts         # server-only: workspace/user lookup+upsert
      build-request-modal.ts      # pure: Block Kit modal builder (incl. M4 Approver users_select)
      validate-request-submission.ts  # pure: view_submission validation (unit tested)
      validate-request-submission.test.ts
      build-approval-notification.ts  # pure: approver DM builder, message update, outcome text
      parse-block-action.ts       # pure: block_actions (Approve/Reject) validation — message- and modal-origin (unit tested)
      parse-block-action.test.ts
      compute-decision-outcome.ts # pure mirror of decide_on_request()'s algorithm (unit tested; both routing models)
      compute-decision-outcome.test.ts
      build-requester-decision-notification.ts  # pure: final-decision requester DM + notification gating
      build-requester-decision-notification.test.ts
      approval-actions.ts         # server-only: decide_on_request() RPC wrapper
      approval-policies.ts        # server-only: active-policy lookup + policy recipient list
      notify-approvers.ts         # server-only: sends DMs to a precomputed recipient list
      notify-requester.ts         # server-only: sends the final-decision DM to the requester
      status-display.ts           # pure (M5): status emoji + text label (unit tested)
      status-display.test.ts
      parse-requests-action.ts    # pure (M5, extended M6): /requests + Home navigation click validation, incl. views.open vs. views.push origin (unit tested)
      parse-requests-action.test.ts
      build-requests-views.ts     # pure (M5): Request Center / Waiting List / Request Details Block Kit views (unit tested)
      build-requests-views.test.ts
      build-app-home-view.ts      # pure (M6): App Home Block Kit view builder, reuses build-requests-views' row builder (unit tested)
      build-app-home-view.test.ts
      request-views.ts            # server-only (M5, extended M6): listRequestsByRequester (now takes an optional limit), listRequestsWaitingForApprover, getRequestDetails
    supabase/
      admin.ts                    # server-only: service-role Supabase client
  types/
    workspace.ts                  # Workspace row type
    request.ts                    # User, RequestType, RequestRow types (incl. M4 routing fields)
    approval.ts                   # ApprovalPolicy, Approval, DecideOnRequestResult types

scripts/
  configure-approval-policy.ts    # admin CLI: assign approvers to a request type (not an HTTP endpoint)

supabase/
  config.toml
  migrations/
    *_create_workspaces.sql
    *_add_slack_installation_to_workspaces.sql
    *_enable_workspaces_rls.sql
    *_create_request_data_model.sql
    *_create_approval_schema.sql
    *_create_decide_on_request_function.sql
    *_add_direct_approver_routing_to_requests.sql
    *_update_decide_on_request_for_direct_routing.sql
    *_enforce_direct_approval_threshold.sql
    # M5 adds no migration — the existing schema already had everything needed.
    # M6 adds no migration either — Home is a read-mostly front door over the existing schema.
```
