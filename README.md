# ApproveFlow

ApproveFlow is a Slack-first approval and access-request application.
Slack users will submit requests (production access, deployment approval,
software access, purchase approval, custom approvals), approvers will
approve/reject them directly in Slack, and ApproveFlow will maintain an
audit trail. Later milestones may integrate with AWS, GitHub, Supabase
auth providers, and Google Workspace to automatically grant/revoke
temporary access.

## Current milestone: M4 — Zero-Configuration Direct Approver Selection

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

**Still NOT implemented:** a web admin dashboard, App Home, an audit event
system, automatic access provisioning/revocation (AWS/GitHub/etc.), billing,
rejection-reason modals, escalation, reminders, channel-based approval,
multiple manually-selected approvers, or user authentication. Those belong
to M5 and later.

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
  actions recognized, unknown action ignored, missing identifiers/malformed
  value rejected safely.
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

These are unit tests only. Real Slack traffic (an actual `/request` invocation
and modal submission from Slack's servers) has not been tested — that
requires the Request URLs above to be configured against a publicly
reachable endpoint. See the verification notes in the M1/M2/M3/M4 completion reports.

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
      duration-options.ts         # pure: shared duration select options + labels
      request-types.ts            # server-only: default request types + idempotent seeding
      workspace-lookup.ts         # server-only: workspace/user lookup+upsert
      build-request-modal.ts      # pure: Block Kit modal builder (incl. M4 Approver users_select)
      validate-request-submission.ts  # pure: view_submission validation (unit tested)
      validate-request-submission.test.ts
      build-approval-notification.ts  # pure: approver DM builder, message update, outcome text
      parse-block-action.ts       # pure: block_actions (Approve/Reject) validation (unit tested)
      parse-block-action.test.ts
      compute-decision-outcome.ts # pure mirror of decide_on_request()'s algorithm (unit tested; both routing models)
      compute-decision-outcome.test.ts
      approval-actions.ts         # server-only: decide_on_request() RPC wrapper
      approval-policies.ts        # server-only (M4): active-policy lookup + policy recipient list
      notify-approvers.ts         # server-only: sends DMs to a precomputed recipient list
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
```
