# ApproveFlow

**ApproveFlow is lightweight employee/workplace approvals in Slack.** It
solves "I need approval for something at work" — vacation and time off,
doctor appointments, working from home, personal time, schedule changes,
expenses and purchases, or anything else — not infrastructure access
provisioning. A requester describes what they need and picks an approver
(or, optionally, an admin configures a standing policy); the approver
decides right in Slack; the requester is notified; the full history is
always available from `/requests` or the App Home tab.

**ApproveFlow is explicitly NOT:** an AWS/IAM access-provisioning product,
an HRIS, a PTO-balance or leave-accrual system, or a calendar. It never
asks for or stores any third-party infrastructure credentials (AWS, GitHub,
Google Workspace, Okta, or otherwise), and it never provisions or revokes
anything downstream — the approval decision itself *is* the entire product.
An earlier direction (see "Previously" below) explored positioning this as
an AWS-access-request tool; M8 deliberately narrowed the MVP to this
simpler, more universal workplace-approvals scope instead.

## Current milestone: M8.1 — Slack Production Hardening

M8.1 doesn't change the product surface at all — no new fields, no new
request types, no UI changes anywhere. It hardens three things the M8 field
matrix's own production E2E testing exposed as real gaps: (1) several Slack
interaction handlers did more synchronous work before acknowledging Slack
than the ~3 second interactivity window comfortably allows, occasionally
making an action look like it silently failed; (2) there was no structured
timing data anywhere to see *why*, only ad-hoc `console.error` strings on
failure paths; and (3) `workspaces` had no concept of "uninstalled" at all —
Slack's `app_uninstalled`/`tokens_revoked` events (now subscribed) were
silently ignored. See [M8.1: Slack Production
Hardening](#m81-slack-production-hardening) below for the full design:
which work now happens via `next/server`'s `after()` instead of blocking
the response, the new workspace installation lifecycle
(`INSTALLED`/`TOKEN_REVOKED`/`UNINSTALLED`), and the minimal structured
latency instrumentation added alongside it. **Implemented and locally
verified — not yet deployed** (migration not yet pushed, nothing committed).

## Previously: M8 — MVP Product Simplification

M8 doesn't add new plumbing — M2–M7's request/approval/notification/comment
pipeline is untouched — it changes *what the product is for*. The default
request types requesters see are now **Vacation / Time Off, Doctor
Appointment, Work From Home, Personal Time, Schedule Change, Expense /
Purchase, and Other Request**, in place of the original AWS-flavored set
(Production Access, Deployment Approval, Software Access, Purchase
Approval, Custom Request). "Resource" and "Reason" (both inherited
AWS-access language) are gone from the customer-facing UI, merged into a
single universal **Details** field.

The Create Request modal is now **request-type-aware**: it dynamically
re-renders (via `views.update`, triggered by the Request Type field's
`dispatch_action`) to show only the fields that actually make sense for the
selected type — a day-level date range for Vacation/WFH/Personal Time, a
single date plus a start/end time for Doctor Appointment/Schedule Change,
an Amount+Currency pair for Expense/Purchase, and the full flexible
optional-timing shape for Other Request. See [M8: MVP Simplification
architecture](#m8-mvp-simplification-architecture) below for the full field
matrix, the dynamic-modal mechanism, and the centralized
`request-type-config.ts` that drives modal building, submission validation,
and input preservation from one shared definition. DIRECT
(requester-picks-an-approver) routing remains the zero-config MVP default;
the POLICY engine is untouched and still available as an advanced, optional
capability; legacy technical request types remain in the database for
historical rendering but are deactivated for new request creation.
**Deployed and production-E2E-verified** (`3cd9f3d`).

## Previously: M7 — Decision Comments & Rejection Reasons

M7 gave Approve/Reject decisions context. Clicking **Approve** opens a
small modal with an optional **Comment** field; clicking **Reject** opens
one with a **required Reason** field (blank/whitespace-only is rejected
with a Slack-native validation error, never silently accepted). Submitting
either modal re-authorizes and records the decision atomically through the
same `decide_on_request()` RPC as every prior milestone — opening the modal
itself grants no authorization at all. The comment/reason is persisted
immutably on the `approvals` row, shown in Request Details next to the
relevant decision, and included in the requester's final-decision
notification. No new authorization model, no new Slack scope. Deployed and
production-verified (both DIRECT and POLICY paths). See [M7: Decision
Comments architecture](#m7-decision-comments-architecture) below.

## Previously: M6 — Slack App Home

M6 added a persistent **App Home** tab and made it the **primary navigation
surface** for ApproveFlow. Opening the Home tab shows a short intro, a
single top-level **Create Request** button, a "My Requests" summary (your 3
most recent, plus a **View all requests** button that appears once there
are more than 3 — opening the same Request Center `/requests` uses), and a
"Waiting for Me" summary (a count + button, or "Nothing is waiting for your
approval." when there's nothing to decide). `/requests` remains a useful
Slack shortcut that opens the exact same Request Center directly, for
anyone who prefers typing a command over opening the Home tab. Every Home
action reuses the exact M2–M5 modal builders/queries/decision path
unchanged — Home only adds a new entry point and a new Slack Events API
endpoint (`/api/slack/events`) that listens for `app_home_opened` and
republishes the tab. No web dashboard, no login, no new Slack scopes, no
database migration. See [M6: App Home
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

**M7 adds no new scope either.** `views.open`/`views.push`/`views.update` —
the only Slack Web API calls the decision-comment modal flow uses — are all
already covered by the `chat:write`/Interactivity-enabled posture from
M3/M5; opening one more modal type requires nothing new. `SLACK_BOT_SCOPES`
in `src/lib/slack/install-provider.ts` remains exactly
`["commands", "chat:write"]`, unchanged since M1/M3.

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

## M8.1 Slack configuration: app_uninstalled and tokens_revoked

Same **Features → Event Subscriptions → Subscribe to bot events** panel as
M6 — no new Request URL, no new OAuth scope. Add `app_uninstalled` and
`tokens_revoked` alongside the existing `app_home_opened`, then save. Like
M6's own event subscription, this is an app **configuration** change, not
an OAuth grant — existing installations start receiving both events as soon
as this is saved, with no reinstall required. See [M8.1: Slack Production
Hardening](#m81-slack-production-hardening) above for what the app does
with each event.

## Local vs. production architecture

Every route is a stateless Next.js Route Handler: no persistent Node
server, no WebSockets, no queue, no background worker service — this runs
as-is on Vercel serverless functions with no architectural changes between
local and production. Through M8, every route did all of its work
(including notification sends) synchronously before responding. **As of
M8.1, work that doesn't need to gate the HTTP response — approver/requester
notifications, the request-type dynamic modal update, App Home publishing,
and lifecycle event processing — runs via `next/server`'s `after()`
instead, while `trigger_id`-bound `views.open`/`views.push` calls and
anything the response's own correctness depends on stay synchronous.** See
[M8.1: Slack Production Hardening](#m81-slack-production-hardening) above
for the full per-flow breakdown, the latency instrumentation added
alongside it, and why this still uses no queue/worker — `after()` runs
within the same Vercel function invocation (via Vercel's `waitUntil`), not
a separate durable job.

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
- `--request-type`: any request type key that exists for that workspace —
  as of M8 the default MVP keys are `vacation_time_off`,
  `doctor_appointment`, `work_from_home`, `personal_time`,
  `schedule_change`, `expense_purchase`, `other`. (Workspaces installed
  before M8 also have the original `production_access`,
  `deployment_approval`, `software_access`, `purchase_approval`, `custom`
  rows — deactivated from new request *creation* but still fully valid here,
  since policy configuration is a per-key operation independent of the
  `active` flag; the existing Production Access policy from before M8
  keeps working exactly as configured.) These only exist once a request has
  been created at least once in that workspace (that's what seeds the
  defaults) — create one first if you get a "no request type" error.
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
changes. **M7's comment/reason validation is deliberately NOT added to this
mirror** — it's an input-normalization rule, not an authorization/threshold
rule, so it doesn't change which of the existing 17 cases apply; see [M7:
Decision Comments architecture](#m7-decision-comments-architecture) for
where comment validation actually lives and how it's verified instead.

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
   first one (see below). `listRequestsByRequester`'s `totalCount` (already
   returned by the same query via Postgres's exact `count`, no extra query)
   is passed straight through to the view builder — it decides whether "View
   all requests" is worth showing, nothing else.
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

### The Home actions — reuse, not a second system

Home has **no top-level "Open Request Center" button** — once App Home
exists, it *is* the primary navigation surface, so a second general-purpose
launcher button next to Create Request was redundant. What remains:

| Home action | Action ID | Shown when | Reuses |
| --- | --- | --- | --- |
| **Create Request** | `create_request_home` (new) | Always | `ensureDefaultRequestTypes` + `listActiveRequestTypes` + `buildRequestModal` — identical bootstrap to `/request`, including a freshly generated `idempotencyKey` |
| **View** (a My Requests row) | `view_request` (M5, unchanged) | One per shown row | `getRequestDetails` + `buildRequestDetailsView` |
| **View all requests** | `open_request_center` (unchanged action id, relabeled + relocated) | Only when `myRequestsTotalCount > shown rows` — i.e. there's more than the 3 already visible | `listRequestsByRequester` (default limit 10) + `listRequestsWaitingForApprover` + `buildRequestCenterView` — identical to `/requests` |
| **View pending approvals** | `view_waiting_requests` (M5, unchanged) | Only when Waiting for Me count > 0 | `listRequestsWaitingForApprover` + `buildWaitingListView` |

"View all requests" sits under the "My Requests" section (not top-level)
and reuses the *exact same* `open_request_center` action id and Request
Center dispatch branch that existed before this UX refinement — only the
button's placement, label, and visibility condition changed; the
interactions route's handling of it is untouched. `/requests` still opens
this identical Request Center directly, unconditionally, as a Slack
shortcut for anyone who prefers typing a command.

The row-level and pending-approvals actions are the *same* action IDs and
the *same* buttons M5 already renders inside the Request Center modal —
Home's "My Requests" rows are built with the same exported
`buildRequestRowBlocks` helper (`build-requests-views.ts`), so a click
behaves identically no matter which surface it came from.

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

- Intro/tagline and a single top-level **Create Request** button render —
  there is no top-level "Open Request Center" button.
- My Requests shows "You haven't submitted any requests yet." with **no**
  "View all requests" button (nothing to view yet).
- Waiting for Me shows "Nothing is waiting for your approval." — no button.

### Test B — My Requests summary (capped at 3) and "View all requests"

On an account with **3 or fewer** requests submitted: open Home.

- All of them appear, newest first, correct statuses.
- **No** "View all requests" button — everything is already shown.

On an account with **more than 3** requests submitted: open Home.

- Exactly the 3 most recent appear (never more), newest first, correct
  statuses.
- Compare against `/requests` on the same account — the same 3 requests
  (by id/status/resource) should be the top 3 there too.
- A **View all requests** button appears below the 3 rows.

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

### Test E — "View all requests" from Home, and the `/requests` shortcut

1. On an account with more than 3 requests, click **View all requests** on
   Home (under My Requests).
2. The exact same Request Center modal `/requests` opens — full My Requests
   list (up to 10) and Waiting for Me summary.
3. From inside it, click **View** on a row → pushes Request Details onto the
   *same* modal (back arrow appears) — this is the unchanged M5 `views.push`
   path, not `views.open`, since this click originates from inside an
   already-open modal, not from Home.
4. Separately, run `/requests` directly (not via Home) → the identical
   Request Center opens immediately, confirming it remains a working
   shortcut independent of Home.

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

## M7: Decision Comments architecture

### What changed, and what deliberately didn't

Approve/Reject no longer commits a decision on click. The click now opens a
small modal (optional Comment for Approve, required Reason for Reject);
submitting *that* modal is what actually calls `decide_on_request()`. This
is the only behavioral change — the RPC's authorization branches (DIRECT
exact-approver-id, POLICY live-membership), the row lock, duplicate-decision
prevention, immediate-rejection semantics, and threshold-approval semantics
are all copied verbatim from the M4 migration into the M7 one. Nothing about
*who* can decide, or *when* a decision finalizes a request, changed.

### `approvals.comment` already existed — this just enforces and surfaces it

`approvals.comment` has existed since the M3 schema, and `decide_on_request`
has accepted a `p_comment` parameter and inserted it since the M4 routing
update — no caller ever passed one, so every existing row has `comment =
NULL`. M7 doesn't add a column; it adds validation (in the RPC) and two
CHECK constraints (in the schema), then finally gives the UI a way to
populate it.

### Schema migration: `20260915212000_add_approval_comment_constraints.sql`

Two constraints on `approvals`:

- `approvals_comment_max_length` — `comment IS NULL OR length(comment) <=
  1000`. Added as a normal (immediately validated) constraint — safe,
  because every existing row has `comment = NULL`.
- `approvals_rejected_requires_comment` — `decision <> 'REJECTED' OR
  (comment IS NOT NULL AND length(trim(comment)) > 0)`. Added `NOT VALID`.

#### M7: Production data inspection before migrating

Before writing the migration, production `approvals` was inspected
read-only via the service-role client: **12 rows total — 8 APPROVED, 4
REJECTED, and all 4 REJECTED rows have `comment = NULL`** (zero rows of any
decision have ever had a non-null comment, so the max-length constraint has
nothing to violate either). A standard (validated) `CHECK` for
"REJECTED requires a comment" would immediately fail against those 4
historical rows.

`NOT VALID` is Postgres's built-in answer to exactly this situation: the
constraint is enforced for every INSERT/UPDATE from the moment the migration
runs, but the initial validation scan over existing rows is skipped, so the
4 historical NULL-comment rejections are grandfathered in rather than
fabricated a reason or deleted. This migration deliberately never runs
`VALIDATE CONSTRAINT` afterward — doing so would fail for the same reason.
`approvals` has no `UPDATE` path at all (immutable by design since M3), so
those 4 rows will never be touched again regardless.

### RPC migration: `20260915212100_update_decide_on_request_for_comment_validation.sql`

`decide_on_request(p_request_id, p_approver_id, p_decision, p_comment)` — the
signature is unchanged (`p_comment` has existed since M4). What's new is
three lines inserted right after the existing `p_decision` sanity check,
before the row lock:

```sql
v_comment := nullif(trim(both from p_comment), '');

if v_comment is not null and length(v_comment) > 1000 then
  raise exception 'comment exceeds maximum length of 1000 characters';
end if;

if p_decision = 'REJECTED' and v_comment is null then
  raise exception 'REJECTED decision requires a non-blank comment';
end if;
```

Both `raise exception` paths are defensive backstops for a
should-never-happen case — the same posture as the pre-existing
`p_decision not in ('APPROVED','REJECTED')` check just above them. The
application layer (`validate-decision-submission.ts`) validates first and
gives good Slack-native UX; the RPC is what makes that validation
*authoritative* rather than advisory, exactly like every other rule this
function already enforces.

### 1000-character limit, enforced in three places, none of them truncate

- Slack modal: `max_length: 1000` on the `plain_text_input` element
  (`build-decision-modal.ts`) — Slack's own client refuses to accept more.
- Application validation: `validate-decision-submission.ts` returns a
  `response_action: errors` validation error above the same limit.
- Database/RPC: `raise exception` above the same limit (backstop).

None of the three silently truncates — an oversized value is always
rejected, never cut short.

### Approve/Reject buttons now open modals, not immediate decisions

`src/lib/requests/build-decision-modal.ts` builds the two modals
(`approveflow_approve_decision` / `approveflow_reject_decision` callback
IDs — two distinct callback IDs, not one shared one with a "decision" field
in `private_metadata`, specifically so *which* decision this is comes from
Slack's own trusted `view.callback_id`, never from a value this app would
otherwise have to trust out of `private_metadata`). `private_metadata`
carries only `{ requestId, source }` — `requestId` is an opaque locator
(re-validated by `decide_on_request` regardless of what's passed), and
`source` says only where to reflect the outcome afterward:
`{ type: "message", channelId, messageTs }` or `{ type: "modal", viewId }`.
It deliberately does **not** carry the original message/view `blocks` —
doing so risked overflowing Slack's 3000-character `private_metadata` limit
for a request with a long resource/reason, since that content would have to
survive a full round trip through the Slack client. Instead, the
message-origin reflect step rebuilds the DM content fresh from the (immutable)
request row via the existing `buildApprovalNotification` +
`replaceActionsWithStatus` — deterministic, and reusing exactly the same two
functions the pre-M7 flow already used, just called with fresh data instead
of payload-echoed blocks.

`views.open` vs. `views.push` for the decision modal follows the same rule
M6 established for Home vs. modal origin: a message-origin click has no
modal stack to append to (`views.open`); a click from inside the M5 Request
Details modal stacks the decision modal on top of it (`views.push`) — so its
Cancel button naturally returns to Request Details, already updated once
the decision modal closes.

### Final submission re-authorizes independently — opening the modal proves nothing

`handleDecisionSubmission` in `src/app/api/slack/interactions/route.ts` is
the only place a decision is actually recorded. It:

1. Validates the Slack signature (already done before any payload is parsed).
2. Re-resolves `slackTeamId`/`slackUserId` from the signed
   `payload.team`/`payload.user` envelope — never from `private_metadata`.
3. Reads `requestId`/`source` out of `private_metadata` as opaque locators only.
4. Upserts the acting Slack user, then calls `decideOnRequest()` — which
   re-runs the *entire* DIRECT/POLICY authorization check from scratch.

Nothing about having successfully opened the modal is trusted at this step.
This matters most for POLICY routing, where membership is live: if someone
is removed from a policy between opening the Approve modal and submitting
it, `decide_on_request` returns `unauthorized` at submission time exactly as
if they'd never opened it — the same guarantee already verified for M5/M6's
modal-origin decisions, now exercised across a two-step (open, then submit)
interaction instead of one.

### Validation UX vs. RPC authority

- **Reject with a blank/whitespace reason**: `validate-decision-submission.ts`
  returns `response_action: errors` attached to the Reason block — modal
  stays open, nothing is written.
- **Oversized comment/reason**: same — a validation error, never truncated.
- **A decision that passed structural validation but the RPC couldn't apply**
  (`not_found`, `already_final`, `unauthorized`, `already_decided`,
  `no_policy`) — the modal is replaced in place
  (`response_action: "update"`) with a small result view built via the
  existing `buildErrorView` + `describeDecisionOutcome`, so the user
  understands *why* nothing happened instead of the modal silently closing.
- **A genuinely recorded decision** (`approved`, `rejected`,
  `recorded_pending`) — empty-body ack, which closes the decision modal
  (popping back to Request Details if it was pushed on top of it).

### Request Details and requester notifications

`RequestDecisionRecord` gained a `comment: string | null` field, threaded
through `getRequestDetails`'s existing `approvals` query (one added column,
same workspace-scoped query shape). `decisionLine()` in
`build-requests-views.ts` appends `"<comment>"` under an APPROVED line, or
`Reason: "<comment>"` under a REJECTED line, only when a comment actually
exists — a historical decision with `comment = NULL` renders exactly as it
always has, with no "No comment provided" placeholder.

`buildRequesterDecisionNotification` gained the same `comment` field, with
the same non-misleading POLICY-approval rule M4 already established for
*attribution*: a DIRECT decision's comment is labeled "Comment"/"Reason" and
sits below the existing "Approved/Rejected by" field; a POLICY approval's
comment is labeled generically **"Final approval comment"** with no
attribution line at all, so it can never be read as "the last clicker alone
approved this." `notify-requester.ts` resolves which comment is "the
relevant one" with one extra query: the (unique) REJECTED row for a
rejection, or the most recently-decided APPROVED row for an approval — the
one that just crossed the threshold, which for DIRECT is also the only row
that will ever exist. The existing `isFinalDecisionTransition` gate is
unchanged: intermediate POLICY approvals, duplicates, and already-final
attempts still send zero requester notifications, and a Slack delivery
failure still can't roll back the already-committed decision.

### Known limitation carried over from M4/M5

Requester notification and outcome-reflection are still best-effort,
synchronous, no-retry — a process crash between `decide_on_request()`
committing and the notification call completing loses that one
notification with no queue/retry, exactly the accepted M4 tradeoff. M7
doesn't change this posture.

## M7 end-to-end testing procedure (completed — deployed and production-verified)

Needs: both M7 migrations reviewed and pushed (`pnpm dlx supabase db push`,
not run by me), and at least one workspace with both a DIRECT-eligible and a
POLICY-eligible request type.

### Test A — DIRECT approve with comment

1. As requester, create a Custom Request, selecting another user as approver.
2. As that approver, open it from Waiting for Me (or the DM) → **Approve** →
   enter "Approved for M7 E2E" → submit.
3. Verify: request `APPROVED`; the `approvals` row's `comment` = "Approved
   for M7 E2E"; Request Details shows the comment under the approval;
   requester's DM includes a Comment section with that text; the request no
   longer appears in that approver's Waiting for Me.

### Test B — DIRECT approve without a comment

Repeat Test A leaving Comment blank. Verify: succeeds; `comment` is `NULL`
in the DB; Request Details and the requester DM show no empty Comment
section anywhere (no placeholder text).

### Test C — DIRECT reject requires a reason

1. Click **Reject**, try submitting with the Reason field blank, then
   whitespace-only.
2. Verify each attempt: modal stays open, a validation error appears under
   Reason, no `approvals` row is created (`decide_on_request` never even ran).
3. Enter "Rejected for M7 E2E" → submit.
4. Verify: request `REJECTED`; reason persisted; Request Details shows
   `Reason: "Rejected for M7 E2E"`; requester's DM shows a Reason section
   with that text.

### Test D — POLICY approval

1. Create a Production Access request (policy-routed), selecting a
   non-policy-member as the manual modal approver.
2. Verify routing still overrides the manual selection (`direct_approver_id`
   stays `NULL`, `approval_policy_id` is set) — unchanged M4/M5 behavior.
3. As the actual configured policy member, Approve with an optional comment.
4. Verify: Request Details shows the policy name and the approval comment
   against the correct approver; the requester's final notification (once
   the required-approvals threshold is met) shows "Final approval comment"
   without claiming that approver alone was responsible.

### Test E — security/stale authorization

If practical without disrupting the current production policy
configuration: open the Approve modal as a policy member, then (in a
separate, explicitly-approved step) remove that membership, then submit the
already-open modal. Verify `decide_on_request` returns `unauthorized` and no
approval row is created. **Do not alter production policy membership for
this test without separate explicit approval** — this is the one scenario
in the plan that touches shared configuration state, not just request data.

## M8: MVP Simplification architecture

### What M8 is, and what it deliberately isn't

M8 is a product-scope change, not a re-architecture. Every piece of
plumbing built in M1–M7 — Slack OAuth, request creation, DIRECT/POLICY
routing and authorization, the atomic `decide_on_request()` RPC, Approve/
Reject decision modals with comments, requester notifications, `/requests`,
App Home — is completely unchanged. M8 only changes: which request types
exist by default, the modal's field set/labels, and the duration option
list. No new tables, no new routes, no new Slack scope, no new dependency.

### Zero-config bootstrap already existed — M8 only changed *what* it seeds

Before M8, a genuinely new Slack workspace could already go
install → Home → Create Request → submit without anyone touching Supabase:
`ensureDefaultRequestTypes(workspaceId)` (`src/lib/requests/request-types.ts`)
is idempotent (`ON CONFLICT DO NOTHING` on `(workspace_id, key)`), safe on
reinstall, and was already called at the start of both `/request`'s route
and App Home's "Create Request" handler *before* M8 — this was M2/M6
behavior, not something M8 needed to build. **M8's only change here is the
contents of the `DEFAULT_REQUEST_TYPES` array** it seeds: the 7 workplace
types below, replacing the original 5 AWS-access-shaped ones. A brand-new
workspace installing today gets exactly and only the 7 new types, seeded
automatically, with no admin step.

### `request_types.active` already was the exact mechanism needed

Hiding the old defaults from new request creation, without touching
history, needed no schema change at all: `request_types.active` (boolean,
M2) and `listActiveRequestTypes()`'s existing `.eq("active", true)` filter
already do precisely this — a deactivated row is unselectable in the modal
and rejected server-side by `validateRequestSubmission`'s
`validRequestTypeKeys` check, while remaining a perfectly valid foreign key
for every historical request, approval, and policy that already reference
it. M8 needed one data migration (see below) to flip that flag for the 5
legacy keys in the one workspace that already had them — new workspaces
never see those keys at all, since they're no longer in
`DEFAULT_REQUEST_TYPES`.

### New default request types

| Key | Label |
| --- | --- |
| `vacation_time_off` | Vacation / Time Off |
| `doctor_appointment` | Doctor Appointment |
| `work_from_home` | Work From Home |
| `personal_time` | Personal Time |
| `schedule_change` | Schedule Change |
| `expense_purchase` | Expense / Purchase |
| `other` | Other Request |

Keys are internal only — never shown in any Slack surface, exactly like the
5 keys they replace never were.

### Legacy request types: deactivated, never deleted

`production_access`, `deployment_approval`, `software_access`,
`purchase_approval`, and `custom` are **not** removed from the database —
deleting them would violate the `requests.request_type_id` and
`approval_policies.request_type_id` foreign keys (`ON DELETE RESTRICT`
and, for policies, plain `ON DELETE CASCADE` respectively — either way,
deleting a still-referenced row is exactly the kind of history-destroying
change this project has never done). Production, before this migration,
had 16 historical requests against these keys (8 `custom`, 8
`production_access`) and one active policy ("Production Access Approval")
on `production_access` — all of that keeps working and rendering exactly
as before. The migration below only sets `active = false` on those 5 rows;
a brand-new user opening Create Request today sees only the 7 new types,
while Request Details/notifications/the policy script still resolve and
display the legacy ones normally by key, wherever history or an explicit
admin script references them directly.

**Tradeoff considered and rejected:** keeping legacy types selectable for
the existing workspace while hiding them only for future ones. Rejected —
it would mean two different "Create Request" experiences depending on
which workspace you're in, undermining the entire point of an MVP-focused
product surface, for a capability (creating a *new* Production
Access-style request) nobody has asked to keep. A clean, identical list for
every workspace was preferred.

### Migrations

Four additive migrations — none edits a historical migration file:

- **`20260916000000_relax_requests_reason_not_null.sql`** —
  `ALTER TABLE requests ALTER COLUMN reason DROP NOT NULL`. The existing
  `char_length(reason) BETWEEN 1 AND 2000` CHECK constraint (M2) needs no
  change: Postgres treats a CHECK expression that evaluates to NULL as
  satisfied (not failed) — `char_length(NULL)` is NULL, so `NULL BETWEEN 1
  AND 2000` is NULL, which passes. Zero risk to history: every existing row
  already has a non-null value satisfying the unchanged CHECK; this only
  widens what's allowed going forward.
- **`20260916000100_deactivate_legacy_request_types.sql`** — a pure data
  fixup, `UPDATE request_types SET active = false WHERE key IN (...)` for
  the 5 legacy keys, global (not scoped to one `workspace_id`) because no
  workspace will ever be seeded with those keys again — any row with one of
  them is by definition a pre-M8 install.
- **`20260916010000_add_request_timing_fields.sql`** — adds
  `requested_start_date`/`requested_start_time`/`requested_end_date`/
  `requested_end_time` (nullable `date`/`time` columns) plus 5 CHECK
  constraints mirroring `validateRequestTiming()` exactly (see [Start/end
  date and time, not a duration dropdown](#startend-date-and-time-not-a-duration-dropdown)
  below). All 5 are immediately valid (not `NOT VALID`) — these are
  brand-new columns, so every existing row has `NULL` in all four,
  trivially satisfying every condition.
- **`20260916020000_add_request_expense_fields.sql`** (not yet pushed) —
  adds `requested_amount numeric(10,2)` and `requested_currency text`
  (both nullable) plus two CHECK constraints, `requests_amount_positive`
  (`requested_amount IS NULL OR requested_amount > 0`) and
  `requests_currency_valid` (`requested_currency IS NULL OR
  requested_currency IN ('USD','EUR','GBP','MKD','CAD','AUD')`). Both are
  immediately valid for the same reason as above — brand-new columns, every
  existing row is `NULL` in both. See [Expense / Purchase: amount and
  currency](#expense--purchase-amount-and-currency) below for why a
  type-coupling rule like "Expense / Purchase requires an amount" is
  deliberately **not** one of these constraints.

### Details vs. Resource — why the column was never renamed

The `resource` column is unchanged. Renaming it would touch every query,
every type, and every historical row's column mapping for zero functional
gain — the customer never sees the column name, only the modal's field
*label*, which is now "Details" everywhere it's rendered (the request
modal, Request Details, the approver DM, the requester notification). This
is the same reasoning M6/M7 already applied to internal action IDs and
callback IDs that don't match their current customer-facing label.

### Reason: merged into Details, not duplicated

The original design had two free-text fields — "Resource" (what) and
"Reason" (why) — which made sense for "Production Access as a resource,
debugging an incident as the reason" but is redundant for "Family vacation"
or "Dentist appointment": there's nothing left to separately justify. New
requests collect only **Details** (stored in `resource`, as above) and
leave `reason` as `NULL` — never duplicated into both columns, which would
read as a data-entry bug to anyone inspecting raw rows later. Every reason
consumer (Request Details, the approver DM, the requester notification)
renders a `*Reason:*` line only when one exists — present for every
pre-M8 historical request, absent for every new one. No fabricated
placeholder ever appears, matching the pattern M7 already established for
optional decision comments.

### Start/end date and time, not a duration dropdown

M8's first pass replaced "Duration" with a fixed dropdown offering coarser
workplace-shaped options (30 minutes .. 1 week). Real Slack testing
immediately exposed why that's still wrong: "Vacation / Time Off, 1 week"
doesn't say *which* week, and "Doctor Appointment, 2 hours" doesn't say
*when* the appointment is. A duration — however coarse — can never answer
"when," because it isn't an instant or a date, only a span.

The corrected design drops the dropdown entirely and captures the actual
dates/times via four independent, optional fields, each a native Slack
Block Kit element:

| Field | Element | Optional |
| --- | --- | --- |
| Start date | `datepicker` | yes |
| Start time | `timepicker` | yes |
| End date | `datepicker` | yes |
| End time | `timepicker` | yes |

All four are stored as literal local values — a `date` string
("2026-09-21") and a `time` string ("10:00") — exactly as the requester
picked them, in `requested_start_date`/`requested_start_time`/
`requested_end_date`/`requested_end_time`. **ApproveFlow performs no
timezone conversion of any kind, on read or write.** This app has no
reliable per-employee or per-workspace timezone model, so DATE/TIME
(not `timestamptz`) was a deliberate choice: storing an absolute instant
would require silently picking a timezone (almost certainly the server's,
UTC) to convert into, which risks misrepresenting what the requester
actually meant. A `date`/`time` pair makes no such claim — it's just the
human value as entered.

The 5-constraint CHECK-constraint backstop at the database level (see
[Migrations](#migrations) above and [Request Details](#request-details)
below for how "nothing supplied" renders) mirrors this app-level validation
exactly: a start time needs a start date; an end date needs a start date;
an end time needs an end date; the end date can't be before the start
date; and when start and end land on the exact same calendar date with
both times present, the end time must be strictly after the start time.
Critically, a same-day or multi-day range is never rejected just because
*one side's* time was left blank — only ever having both a date pair and
both times, with the times in the wrong order, is invalid.

No calendar integration, no PTO balance, no leave accrual, no
business-day math, and no automatic expiration exist anywhere in this
design — these are still plain date/time form fields, not a scheduling
system.

### One more correction: a universal field set was still the wrong shape

The four-field design above (all optional, identical for every request
type) shipped and passed a first round of real Slack testing, but broader
usage exposed a second UX problem: showing the *same* Start date/Start
time/End date/End time fields for every type is confusing when most types
don't need all four. A Vacation request never needs times. A Doctor
Appointment needs exactly one date (asking for a "Start date" *and* an
"End date" when it's the same day reads as broken). An Expense / Purchase
needs no timing at all — it needs an amount and a currency instead, which
the original design had no field for whatsoever. "Other Request" is the
one case that genuinely benefits from full flexibility, since by
definition it's the type that doesn't fit a more specific shape.

The corrected design makes the Create Request modal **request-type-aware**
instead of universal: the fields shown depend on the currently selected
Request Type, driven by one centralized configuration object rather than
scattered per-field conditionals.

### Centralized field configuration: `request-type-config.ts`

`REQUEST_TYPE_FIELD_CONFIG` (`src/lib/requests/request-type-config.ts`) is
the single source of truth for which fields a given request type key
shows, consumed identically by the modal builder, the submission
validator, and the dynamic re-render/input-preservation logic below — none
of those three places contains its own `if (type === "vacation_time_off")`
branching; they all call `getRequestTypeFieldConfig(key)` and act on the
returned `{ timingMode, expense }` pair. An unrecognized or legacy type key
(e.g. `production_access`) safely falls back to the most permissive shape
(`OPTIONAL_RANGE`, no expense fields) rather than throwing.

`timingMode` is one of four values:

| `timingMode` | Types | Fields shown |
| --- | --- | --- |
| `DATE_RANGE` | Vacation / Time Off, Work From Home, Personal Time | Start date, End date (both required, no times) |
| `SINGLE_DATE_TIME_RANGE` | Doctor Appointment, Schedule Change | one **Date** field, Start time, End time (all required) |
| `NONE` | Expense / Purchase | no timing fields at all |
| `OPTIONAL_RANGE` | Other Request | the original four independently-optional Start/End date/time fields — the flexible escape hatch for whatever doesn't fit a more specific shape |

`expense: true` (Expense / Purchase only) additionally shows Amount and
Currency fields; every other type has `expense: false` and never renders
them.

**Details and Approver are universal** — every type shows exactly one
Details field (`resource` column, placeholder text adapted per type, e.g.
"What's the occasion? (optional context)" for Vacation vs. "What are you
purchasing?" for Expense) and exactly one Approver field, regardless of
`timingMode`/`expense`.

### `SINGLE_DATE_TIME_RANGE`: one date, never asked twice

Doctor Appointment and Schedule Change show a single **Date** field (not
"Start date") plus Start time and End time — asking a requester to pick
the same date twice would be nonsensical. Server-side, this reuses the
*existing* `validateRequestTiming()` unchanged: the single submitted date
is used to construct `{ startDate: date, endDate: date, startTime,
endTime }` before validation, which naturally satisfies the existing
same-day strict `endTime > startTime` check with no new validation logic.
Persistence always writes `requested_end_date = requested_start_date`; a
client-crafted payload with a *different* end date is explicitly rejected
server-side rather than silently trusted or silently overwritten.

### Dynamic modal: `dispatch_action` + `views.update`, no new route

Changing the Request Type dropdown must change which fields are visible
*before* the requester submits, which Slack can only do by re-rendering
the open modal. The Request Type `static_select`'s enclosing `input` block
sets `dispatch_action: true`, so selecting a new type fires a normal
signed `block_actions` interaction immediately (in addition to being
captured at final `view_submission`, as usual) — handled in the *existing*
`/api/slack/interactions` route by a new `handleRequestTypeChanged`
branch; no new HTTP route was needed. That handler determines the newly
selected type key, computes its `RequestTypeFieldConfig`, reads the
modal's own echoed-back live field values (`payload.view.state.values`),
best-effort maps them onto the new shape (see next section), rebuilds the
view via `buildRequestModal(...)`, and pushes it back with
`views.update({ view_id, hash })` — the same `view_id`/`hash` update
mechanism M5/M7 already use to reflect a decision outcome in place. Slack
returns `hash_conflict` if two updates race (e.g. very rapid repeated type
switching); it's caught and logged, non-fatal, and simply skips that one
stale update. The selected type is treated purely as UI state for
rendering — it carries no authorization weight of its own, and the final
submission is independently re-validated against whatever type was
selected at submission time (see [Type-specific server
validation](#type-specific-server-validation-is-not-optional) below).

### Input preservation across a type change — best-effort, never fabricated

Two pure, independently unit-tested functions
(`remapTimingForModeChange`, `remapExpenseForModeChange` in
`request-type-config.ts`) decide what carries over when the requester
changes their mind about the type mid-fill:

- Details and Approver are **always** preserved, regardless of type.
- Switching between two `DATE_RANGE` types (e.g. Vacation → Work From
  Home) keeps both dates.
- Switching to `NONE` (Expense) drops all timing — an amount/currency
  request has no use for dates.
- Switching to `SINGLE_DATE_TIME_RANGE` keeps `startDate ?? endDate` as
  the one remaining date plus both times, and drops the second date — it
  is never fabricated from nothing.
- Switching to `OPTIONAL_RANGE` (Other) preserves everything unchanged,
  since it can represent anything the other shapes can.
- Expense fields (Amount/Currency) are dropped entirely when switching
  away from Expense / Purchase, and preserved when switching between
  Expense and Expense (a no-op in practice, included for completeness).

None of this preserved state has any authorization meaning — it is purely
a UX convenience so the requester doesn't have to retype Details after
exploring a couple of request types, and the **final** selected type at
submission time is the only thing that determines which fields are
accepted (see next section).

### Type-specific server validation is not optional

The modal only *hiding* a field is a UI convenience, not a security
boundary — `validateRequestSubmission()` independently re-derives the
final selected type's `RequestTypeFieldConfig` from the submitted payload
and enforces its rules regardless of what the modal happened to render,
rejecting a crafted payload that supplies fields inapplicable to that type
(e.g. a `expense_purchase` submission carrying start/end dates, or a
`vacation_time_off` submission carrying an amount) exactly as it rejects
missing required fields. This mirrors the existing project posture that
Slack UI state (which buttons/fields are visible) is never trusted as an
authorization or validation boundary on its own — see [Type-specific
server validation is CRITICAL] in the per-type rules table above and the
extensive `validate-request-submission.test.ts` coverage for every type ×
rule combination.

### Expense / Purchase: amount and currency

Expense / Purchase is the one type with no timing at all — it needs an
amount and a currency instead, both new nullable columns
(`requested_amount numeric(10,2)`, `requested_currency text`, migration
`20260916020000_add_request_expense_fields.sql`). `numeric(10,2)` was
chosen over `float`/`real` because money must never accumulate
floating-point rounding error; the app-layer regex in
`validateExpense()` (`src/lib/requests/expense.ts`) — not the column's
typmod — is the layer that actually *rejects* more-than-2-decimal-place
input (Postgres's own `numeric(10,2)` would otherwise silently *round* a
value like `499.999` to `500.00` rather than error, which would silently
misrepresent what the requester typed). Currency is a small fixed
ISO-4217-style allow-list — `USD, EUR, GBP, MKD, CAD, AUD` — enforced both
in `SUPPORTED_CURRENCIES` (app code) and a matching DB CHECK constraint;
there is deliberately no FX conversion, no currency-rate API, and no
localization engine anywhere in this design. Adding a 7th currency later
is a small follow-up migration plus a one-line array update, an accepted
MVP tradeoff.

**Why "Expense / Purchase requires an amount" is not a DB constraint:**
`amount > 0` and `currency IN (...)` are simple, row-level checks that
only ever look at the row being inserted — exactly the shape a Postgres
CHECK constraint is good at, and both are immediately valid today because
the columns are brand-new (every existing row is `NULL` in both,
trivially satisfying an `IS NULL OR ...` check). A rule like "a row whose
`request_type_id` resolves to `expense_purchase` must have a non-null
amount," by contrast, needs to know something about the *related*
`request_types` row — either denormalizing `request_types.key` onto
`requests` or adding a trigger, both more machinery than a single-request
MVP invariant justifies. That rule is deliberately kept authoritative in
one place instead: `getRequestTypeFieldConfig()` +
`validate-request-submission.ts`. No triggers were added for M8.

### Rendering: amount and timing are mutually exclusive, by construction

Every renderer (Request Details, the approver DM, the requester
notification, App Home/Request Center row summaries) checks both
`formatWhenLabel(...)` and the new `formatAmountLabel(amount, currency)`
(`src/lib/requests/expense.ts`) and renders whichever is non-null — never
both, and never a `+` sign or hard runtime assertion enforcing that,
because the type-specific validator already guarantees only one half is
ever populated for any given request. `formatAmountLabel` renders
`"EUR 499.99"`-style (currency code, space, exactly two decimals) and
returns `null` if either half is missing, matching every other formatter
in this codebase's "never render a partial value" convention. Row
summaries show, e.g., "Vacation / Time Off — Family trip / Sep 21 – Sep
25" or "Expense / Purchase — External monitor / EUR 499.99".

### Request modal: field layout by type

**Every type:** Request Type → Details → *(type-specific fields)* →
Approver, organized into visually distinct REQUEST / WHEN / EXPENSE /
APPROVAL groups using Block Kit `context` section labels (bold mrkdwn,
never a fake disabled input standing in as a heading) and dividers:

| Type | Fields between Details and Approver |
| --- | --- |
| Vacation / Time Off, Work From Home, Personal Time | Start date, End date |
| Doctor Appointment, Schedule Change | Date, Start time, End time |
| Expense / Purchase | Amount, Currency |
| Other Request | Start date, Start time, End date, End time (all optional) |

Before any type is selected, the modal shows only Request Type, Details,
and Approver — no WHEN/EXPENSE section renders until there's a type to
determine one. The native Slack `users_select` approver picker is
unchanged and still required — M8 doesn't touch approver selection,
org-chart lookup, or manager directories at all, and its former hint text
explaining policy-vs-manual routing (an internal implementation detail)
was removed — ordinary employees don't need to know or think about it.
DIRECT routing (the requester's selected approver) remains the
zero-config default; if an active POLICY exists for the selected request
type, M4's routing precedence is completely unchanged — POLICY still
overrides the manually selected approver, exactly as it always has. None
of the 7 new default types has a policy configured anywhere, so all of
them route DIRECT out of the box; policies remain available as an
explicit, optional, script-configured capability (see [Approval policy
configuration](#approval-policy-configuration-optional-m3) above) for
whoever wants that on top.

### The shared timing formatter, and the historical duration fallback

One function, `formatWhenLabel()` (`src/lib/requests/request-timing.ts`),
is the single source of truth for rendering request timing everywhere it
appears — Request Details, the approver DM, the requester notification,
and App Home/Request Center row summaries all call the exact same
function, never reimplementing the logic per surface. It prefers the new
date/time fields when any are set, rendering a single date ("Sep 19,
2026"), a date range ("Sep 21, 2026 – Sep 25, 2026"), same-day times
("Sep 18, 2026, 10:00 – 12:00"), or a full multi-day range with times
("Sep 21, 2026, 09:00 – Sep 25, 2026, 17:00") — labeled **"When"**. A
partial time (only a start or only an end time supplied) is still shown,
never silently dropped or invented on the other side. When none of the
four new fields are set at all, it falls back to the historical
`requested_duration_minutes` value (every one of the 16 pre-correction
requests, plus any brand-new request where the requester left every timing
field blank) — labeled **"When / Duration"**, a deliberately different
label so a reader can never mistake a historical duration figure for a
real date. When there is truly nothing to show (a new request with no
timing and no legacy duration, e.g. most "Expense / Purchase" requests),
the field is omitted entirely — never "Not specified," "NULL," "0
minutes," or "undefined."

`requested_duration_minutes` itself is untouched and permanently retained
for this historical fallback — new requests always leave it `NULL`. The
historical label lookup table (`DURATION_OPTIONS` in
`duration-options.ts`) must always reflect the *original* M2–M7 scale
(30 minutes .. 1 day) actually offered to real users at the time — not
any later, short-lived option list — since production data already
proved why that matters: one real historical request has
`requested_duration_minutes = 240`, selected as "4 hours" under the
original scale. M8's first pass briefly relabeled 240 as "Half day" in a
newer (and quickly discarded) option list, which would have silently
misrepresented that request's own history. That request correctly shows
"4 hours" again.

`formatWhenLabel()` is a *rendering* function, entirely independent of the
type-aware validation added afterward — it renders whatever combination of
date/time fields a request actually has, regardless of which request type
it belongs to or which modal shape was in effect when it was created. This
matters for the handful of real requests created during the brief window
when the Create Request modal still showed the original universal
four-field shape (before it became type-aware): those rows can have, for
example, a `vacation_time_off` request with only a start time and no
dates, a combination the *new* type-aware submission validator would now
reject for that type. That's fine and expected — the type-aware rules
introduced in this milestone apply only to *new* submissions going
forward; they are never retroactively enforced against, or used to
reject the rendering of, already-created rows. Those requests keep
rendering through the same `formatWhenLabel()`/`formatAmountLabel()` path
as everything else, exactly as entered.

### An incidental bug found and fixed while adding modal tests

`build-request-modal.ts` had never had a unit test file before M8 (no prior
milestone needed one). Adding one surfaced a latent bug: the file imported
`DURATION_OPTIONS`/`RequestType` via the `@/` path alias, which — per this
project's established constraint (see `verify-request.ts`'s and every other
pure module's header comments) — never resolves under Node's test runner,
only under Next's bundler. This was invisible in production (Next always
resolved it correctly) but made the file untestable in isolation. Fixed by
switching to the same relative `./`/`../` import style every other pure
cross-imported module in this codebase already uses. Purely a testability
fix — zero behavior change, confirmed by an unchanged build output.

## M8 end-to-end testing procedure (completed — deployed and production-verified)

All four M8 migrations, including
`20260916020000_add_request_expense_fields.sql`, are pushed and verified
against production. The procedure below was executed as written.

### Test A — existing workspace upgrade: date range (Vacation / Time Off)

1. Open App Home → **Create Request**. On first open, Request Type must
   show exactly the 7 new workplace types — none of the 5 legacy ones —
   and the modal must show only Request Type, Details, and Approver; no
   WHEN or EXPENSE section renders until a type is picked.
2. Select "Vacation / Time Off" — confirm the modal immediately re-renders
   in place (`views.update`) to add Start date and End date (both marked
   required, no times, no Amount/Currency).
3. Details: "M8 Vacation Test", Start date: a future date, End date: a few
   days later, Approver: the other test account. Submit.
4. Verify the approver's DM shows `Details: M8 Vacation Test` and
   `When: <start date>, 2026 – <end date>, 2026`, and routes DIRECT.
5. Approver approves with "Approved for M8 E2E". Verify: request APPROVED,
   Request Details shows the correct date range, the requester notification
   shows the same range and the M7 comment, and no "Duration" terminology
   appears anywhere for this new request.

### Test B — Doctor Appointment: one date, two times, same day

1. Create Request → select "Doctor Appointment" — confirm the modal
   re-renders to show exactly one **Date** field (not "Start date") plus
   Start time and End time — no End date field at all.
2. Details: "M8 Dentist Test", Date: one future date, Start time: "10:00",
   End time: "12:00", Approver: the other account. Submit.
3. Verify `When: <date>, 2026, 10:00 – 12:00` renders identically in
   Request Details, the approver's view, and the requester's final
   notification once decided. Confirm in Supabase that
   `requested_end_date` was persisted equal to `requested_start_date`, not
   null and not a different date.

### Test C — Expense / Purchase: amount and currency, no timing at all

1. Create Request → select "Expense / Purchase" — confirm the modal
   re-renders to show Amount and Currency fields, and no timing fields of
   any kind.
2. Details: "M8 Monitor Test", Amount: "499.99", Currency: "EUR",
   Approver: the other account. Submit.
3. Verify: succeeds, `Amount: EUR 499.99` renders in Request Details, the
   approver DM, and the requester notification — no "When" field appears
   anywhere for this request. Safe to leave PENDING.

### Test D — dynamic modal: input preservation across a type change

1. Create Request → select "Vacation / Time Off", fill Details, Start
   date, End date, and Approver. Without submitting, change the Request
   Type to "Work From Home" — confirm Details, Start date, End date, and
   Approver are all still filled in (both are `DATE_RANGE`, fully
   compatible).
2. Now change the Request Type to "Expense / Purchase" — confirm Details
   and Approver are still filled in, but the dates are gone (dropped, not
   carried into hidden state) and Amount/Currency are empty (never
   pre-filled from the dates).
3. Fill Amount/Currency, then switch to "Other Request" — confirm
   Details/Approver persist and Amount/Currency are dropped; Other Request
   shows the full four optional timing fields, all empty.

### Test E — validation (per type, crafted-payload resistant)

1. Vacation / Time Off: enter a start date and an *earlier* end date.
   Submit → blocked with a clear field error, no request created.
2. Doctor Appointment: enter Date, start time "10:00", end time "09:00".
   Submit → rejected (end time must be strictly after start time on the
   same day).
3. Expense / Purchase: enter amount "499.999" (3 decimals). Submit →
   rejected, never silently rounded to "500.00" or "499.99". Also try
   amount "0" and a blank currency — both rejected.
4. Confirm a same-day Doctor Appointment/Schedule Change request with only
   one of Start time/End time filled in is **not** rejected by the
   underlying timing check — only a fully-specified, wrongly-ordered pair
   is invalid (this rule is inherited unchanged from the prior timing
   correction, still exercised via the `SINGLE_DATE_TIME_RANGE` path).

### Test F — historical compatibility

1. Open an old historical Production Access request → still opens, still
   says "Production Access", its original Reason still renders, its
   policy/approval history renders correctly.
2. Specifically locate the historical request with a 240-minute duration —
   it must display **"4 hours"**, never "Half day".
3. Confirm the "Production Access Approval" policy is still `active = true`
   with its members unchanged — simply unreachable from new request
   creation.
4. Open any request created during the brief window when the modal still
   showed the old universal four-field shape (before this milestone) —
   it must still render exactly as entered (e.g. a `vacation_time_off`
   request with only a time and no dates, if one exists), never blocked
   or altered by the new type-aware rules, which apply only to new
   submissions.

### Fresh-workspace zero-config journey (separate — after the above)

Cannot be run against the existing production workspace; requires
installing ApproveFlow into a genuinely separate Slack workspace. Install →
open Home → Create Request → confirm all 7 defaults appear immediately
with zero SQL/script/manual Supabase setup → submit a DIRECT request →
approver decides → requester notified.

## M8.1: Slack Production Hardening

### What M8.1 is, and what it deliberately isn't

M8.1 is an internal-reliability milestone, not a product change — no field,
button, or message a requester/approver sees is any different. It follows
an audit of real production behavior after M8 shipped: some Slack actions
occasionally looked like they silently failed (clicking again then
"worked"), there was no structured way to see why, and Slack's own
`app_uninstalled`/`tokens_revoked` events (now subscribed at the Slack app
configuration level) were being silently ignored. M8.1 fixes exactly those
three things.

### ACK-first architecture: what stays synchronous, and why

Every Slack-facing route in this app must return its HTTP response inside
Slack's ~3 second interactivity/event window. Before M8.1, several handlers
did ALL of their work — DB reads/writes and Slack Web API calls alike —
synchronously before that response, including work that had no bearing on
whether the response itself needed to say "success." M8.1 uses
`after()` from `next/server` (Vercel's `waitUntil` under the hood — no new
dependency, works on the Node.js runtime this project already targets, no
`runtime`/`maxDuration` override needed) to move exactly the work that
doesn't need to gate the response into a callback that runs after it's
already been sent, while keeping everything the response's own correctness
depends on synchronous. The dividing line, applied consistently across
every handler:

**Stays synchronous, pre-ack — never moved:**
- Raw-body Slack signature verification, on every route, with no exception.
- Any `views.open`/`views.push` call, because it consumes a `trigger_id` —
  valid for only a few seconds after Slack issues it, and usable exactly
  once. There is no way to defer this call; the only lever is doing less
  DB work *before* it (see below).
- `view_submission` field-level validation that might need to return
  `response_action: "errors"` — Slack requires this to be part of the
  synchronous HTTP response; there is no way to attach a field error
  asynchronously after the fact.
- The one write that the response's own "success" claim depends on: the
  new `requests` row (Create Request submission) and the
  `decide_on_request()` RPC call itself (decision submission) — the empty
  response body that closes a modal must never be sent before the
  corresponding row/decision is actually durably committed.

**Moved into `after()`:**
- Request-type dynamic change (`views.update`) — this call uses
  `view_id`/`hash`, never a `trigger_id`, so it has no few-seconds expiry
  to race against. The handler now does only the minimal synchronous
  presence checks before acking, then resolves the workspace, rebuilds the
  modal, and calls `views.update` entirely after the response.
- Approver notification after a request is created (`chat.postMessage` to
  one or more recipients) — the request row is already committed by the
  time this runs; a slow or failed notification can no longer delay or
  affect the "your request was created" response.
- Reflecting a decision outcome (`chat.update` on the original approver DM,
  or `views.update` on the underlying Request Details modal) and notifying
  the requester, after a decision submission — both were already
  best-effort (a failure never affected the already-committed decision)
  even before M8.1; see "Decision modal lifecycle" below for why deferring
  them is safe, not just convenient.
- `app_home_opened`'s DB reads + `views.publish` — no `trigger_id`, and
  nothing about the event's own (empty) response depends on Home actually
  having been republished by the time it's sent. A redelivered event just
  republishes the same view again — `views.publish` always replaces
  wholesale, so redelivery is a harmless no-op.
- `app_uninstalled`/`tokens_revoked` processing — same reasoning as
  `app_home_opened`: no `trigger_id`, nothing in the response depends on
  the lifecycle write completing synchronously, and both are idempotent by
  construction (see below).

Every background task now runs through `RequestTimer.afterTask()` (see
Latency instrumentation below) rather than a bare `after(async () => {...})`
call, so its own duration and success/failure are logged independently of
the response that already went out.

### Decision modal lifecycle: why deferring the reflect/notify tail is safe

The audit specifically flagged a risk: "an empty successful `view_submission`
ack may close the submitted modal — a deferred `views.update` against a
view Slack has already closed may fail." This was checked directly rather
than assumed away, for both decision origins:

| Origin | What's open before submission | What ack() does | What the deferred update targets | Safe? |
| --- | --- | --- | --- | --- |
| Approve/Reject clicked on a posted DM message | Just the decision modal (opened via `views.open`) | Closes the decision modal | `chat.update` on the **original message** — a completely separate surface | Yes — the message was never part of the modal's lifecycle at all |
| Approve/Reject clicked from Request Details (M5) | Request Details modal, with the decision modal **pushed** on top (`views.push`) | Pops/closes only the top of the stack (the decision modal) | `views.update` on `source.viewId`, the **Request Details view underneath** | Yes — closing the top of a view stack reveals what's underneath; it does not close it. Request Details is still open and a valid `views.update` target after the response is sent. |

Neither deferred call ever targets the view that the response itself
closes — only `response_action: "update"` (used for the "decision could not
be applied" error case, e.g. `already_decided`/`unauthorized`) touches the
actually-closing view, and that path is untouched: it's returned
synchronously, as part of the HTTP response itself, with no separate Slack
API call at all. Both deferred targets were already documented as
best-effort before M8.1 (a failure there never affected the already-recorded
decision) — moving them slightly later doesn't introduce a new risk
category, it only moves an already-non-critical update off Slack's ~3
second budget.

### Reducing DB round trips on `trigger_id`-bound paths

`views.open`/`views.push` calls can't be deferred, so the other lever is
doing less — or more parallel — DB work before them:

- `/request`, `/requests`, and "Create Request" from App Home: the
  `upsertSlackUser` call (whose result isn't needed again in that specific
  branch) now runs concurrently with the `ensureDefaultRequestTypes` →
  `listActiveRequestTypes` chain, instead of strictly before it. That inner
  chain itself stays sequential — a brand-new workspace's very first
  command needs `ensureDefaultRequestTypes` to have committed before
  `listActiveRequestTypes` can see the seeded rows.
- "View Request" (`getRequestDetails`) on a POLICY-routed request was the
  single largest round-trip chain in the app: a main select, then (in
  sequence) a policy-name select, a policy-members select, and a dedicated
  membership + own-decision check. The members query now also selects each
  member's internal `user_id` (not just their Slack ID), and the decisions
  query now also selects `approver_id` — with those two extra columns,
  "is the viewer currently a member, and have they already decided" is
  derived directly from data already being fetched, and the policy-name and
  members queries run in parallel instead of sequentially. This removes two
  entire round trips and parallelizes two more, without changing what's
  authorized — the same membership/already-decided facts are checked, just
  read once instead of re-queried.
- `listRequestsWaitingForApprover`'s remaining two-stage chain (policy
  candidates → excluding already-decided ones) was left unchanged: it's a
  genuine data dependency (the second query needs the first query's
  candidate IDs), not incidental sequencing, and the audit's own guidance
  was not to force a joined/anti-join query or a new RPC where a clean one
  doesn't already exist.

No new `SECURITY DEFINER` RPC was added for any of this — every
optimization above is either parallelizing genuinely independent reads or
reusing data already being fetched, never a new join across the
authorization boundary.

### Latency instrumentation

`src/lib/observability/timing.ts` is the one shared utility, used by every
Slack-facing route instead of the old ad-hoc `console.error`-only logging.
`createRequestTimer(route, flow)` returns a small object that:

- Assigns a correlation `requestId` (a fresh UUID) to every request/event.
- Records signature-verification and payload-parsing time (`markVerify`/`markParse`).
- Wraps individual DB calls and Slack Web API calls (`time("db"|"slack_api", label, fn)`),
  accumulating each bucket's running total and immediately logging an
  individual line if that one call is slow (≥400ms for a DB call, ≥900ms
  for a Slack API call) — so a single slow call is identifiable even inside
  an otherwise-fast request.
- Logs one structured JSON summary line per request (`ack(outcome)`),
  called immediately before the HTTP response is constructed — `info` under
  1000ms, `warn` at/above 1000ms, `error` at/above 2500ms (approaching
  Slack's ~3s window).
- Wraps every `after()` background task (`afterTask(label, fn)`), logging
  its own duration and ok/error outcome independently — a slow or failing
  background task is visible without ever having delayed the response.

It is pure and fully injectable (`now`/`log`/`requestId` overrides), with
no `server-only` dependency, matching this project's established pattern
for testable primitives (see `verify-request.ts`'s injectable `nowSeconds`)
— directly unit tested in `timing.test.ts` with no mocking required.
Events API retry headers (`X-Slack-Retry-Num`/`X-Slack-Retry-Reason`) are
recorded as observational metadata alongside the timing log when present —
never used to skip processing; correctness comes from idempotent handling
of every event, not from assuming Slack delivers exactly once.

**Never logged, by any code path:** Slack bot tokens (encrypted or not),
the signing secret, OAuth codes, raw `Authorization`/signature headers,
decision comments, rejection reasons, request Details/`resource` text, or
any other request content. Only IDs, route/flow/bucket/label names,
durations, and outcome strings — no telemetry vendor, no new dependency.

### Workspace installation lifecycle

Before M8.1, `workspaces` had no notion of "installed" at all — a row
either existed (implicitly installed) or it didn't. A new column,
`installation_status` (`text` + `CHECK`, matching this project's existing
convention for `requests.status`/`approvals.decision`/`requests.routing_type`
rather than a native Postgres `ENUM`), now tracks three states:

| State | Meaning | Bot token |
| --- | --- | --- |
| `INSTALLED` | Normal, usable installation | Present, decryptable |
| `TOKEN_REVOKED` | Slack sent `tokens_revoked` for this workspace's bot token specifically | Cleared (`NULL`) |
| `UNINSTALLED` | Slack sent `app_uninstalled` | Cleared (`NULL`) |

`TOKEN_REVOKED` is deliberately distinct from `UNINSTALLED`, even though
every guard in the app (see below) treats them identically — a revoked
token is not proof the whole app was removed, and collapsing the two would
lose that distinction for support/debugging. A new nullable
`uninstalled_at timestamptz` records when a workspace transitioned into
`UNINSTALLED` — set only on that specific transition, never reset by a
redelivered `app_uninstalled`. The three `bot_access_token_*` columns are
now nullable (relaxed, not dropped) so they can be cleared rather than left
holding a token Slack has already invalidated.

Deliberately **not** added: a `first_installed_at` column (`created_at`
already records when the workspace row was first created, and
`installed_at` already means "most recent successful install" — a third
timestamp would be redundant for this MVP), an index on
`installation_status` (irrelevant at today's workspace count; trivial to
add later), and any trigger or lifecycle RPC (every writer of this column
is already-trusted, signature-verified, service-role server code — unlike
`decide_on_request()`, there's no RLS-bypass/anon-client surface here to
defend against).

### `app_uninstalled`

Resolved from the same signed `team_id` already used for `app_home_opened`.
Handling is idempotent by construction: a pure function,
`computeInstallationTransition({ currentStatus, event })`
(`src/lib/requests/compute-installation-transition.ts`, exhaustively unit
tested for every state × event combination and both delivery orders),
decides the next state and whether `uninstalled_at` should be (re)set —
`UNINSTALLED` is reachable from `INSTALLED` or `TOKEN_REVOKED`, and a
redelivered `app_uninstalled` while already `UNINSTALLED` computes the same
end state without touching the existing `uninstalled_at`. The workspace row
itself, and everything that references it (requests, approvals, users,
request types, policies), is never touched beyond the three lifecycle
columns — nothing is hard-deleted.

### `tokens_revoked`

Slack's `tokens_revoked` payload lists revoked token identifiers — for a
bot token, `event.tokens.bot` is an array of **bot user IDs**, not token
strings. This app already stores the bot user ID from the original OAuth
response (`workspaces.bot_user_id`), so the safe match is: *does the
revoked list include OUR stored bot user ID?* If `bot_user_id` is missing
(shouldn't happen for a real bot-token install) or simply not present in
the revoked list, **no change is made** — a conservative, deliberate
choice. `tokens_revoked` does not, on its own, prove the whole app
installation is gone (unlike `app_uninstalled`), so inventing a broader
identity match beyond this exact comparison was avoided rather than risking
disabling a working installation over an unrelated event. When it does
match: `installation_status` becomes `TOKEN_REVOKED` (unless already
`UNINSTALLED`, which never regresses backward), the token is cleared, and
`uninstalled_at` is left untouched — that field means specifically "we
received `app_uninstalled`." Receiving `app_uninstalled` and
`tokens_revoked` in either order, any number of times, converges on the
same end state, with `UNINSTALLED` always winning as the more final one —
see `compute-installation-transition.test.ts` for every combination this
claim rests on.

### Centralized usable-installation guard

`getUsableInstallation(slackTeamId)` (`src/lib/requests/workspace-lookup.ts`)
is the single place that answers "can we currently call the Slack API for
this workspace" — usable only if `installation_status === 'INSTALLED'` AND
all three encrypted-token columns are present, failing closed identically
for an unknown workspace, an uninstalled one, a token-revoked one, or a
corrupt/partial token row. Its underlying predicate,
`isUsableInstallation()` (`src/lib/requests/installation-usability.ts`), is
a plain, dependency-free type guard, kept in its own module specifically so
it's unit testable without a database — the same split this project already
uses for `decide_on_request()` (SQL) vs. `compute-decision-outcome.ts`
(its pure, tested mirror).

Every call site that is about to decrypt a bot token or call the Slack Web
API now uses this guard instead of the older bare `if (!workspace)` check:
both slash commands, every `interactions` handler that opens/updates a view
or sends a message, and `app_home_opened`'s publish step. The plain,
status-agnostic `findWorkspaceBySlackTeamId` lookup is still used
deliberately in three places where token usability is irrelevant: the
OAuth callback (the one place allowed to transition a workspace *into*
`INSTALLED` — depending on the guard there would be circular), the
`app_uninstalled`/`tokens_revoked` handlers themselves (which must be able
to look up and update a workspace regardless of its current status), and
recording a decision or a new request's authoritative DB row (a pure
Postgres operation that needs no Slack token at all — only the
best-effort notification/reflection tail that follows re-resolves a fresh
usable installation via the guard, inside `after()`).

Uninstalling a workspace never makes its history unreadable — every guard
above only blocks *new* Slack API activity; reading historical
requests/approvals/decisions from Postgres was never gated on installation
status and still isn't.

### OAuth install/reinstall semantics

The OAuth callback's upsert (keyed on `slack_team_id`, unchanged since M1)
now unconditionally sets `installation_status = 'INSTALLED'` and
`uninstalled_at = NULL` on every successful completion — fresh install or
reinstall after an uninstall/token-revocation alike. No "is this a
reinstall" branch was needed: upserting fixed values is idempotent
regardless of the row's prior state. The bot token is always replaced (Slack
always issues a fresh one), `installed_at` is always set to "now" (it means
"most recent install," not "first install"), and the same workspace row —
same `id`, same historical requests/approvals/users/request
types/policies — is reused exactly as it was before M8.1.

### Migration

One new additive migration —
`supabase/migrations/20260917000000_add_workspace_installation_lifecycle.sql`
— not yet pushed. None of the prior M1–M8 migration files are edited.
Adds `installation_status text not null default 'INSTALLED' check (...)`
(the default backfills the current production workspace correctly with no
separate `UPDATE`, since it genuinely is installed today), `uninstalled_at
timestamptz null`, and relaxes `NOT NULL` on the three
`bot_access_token_*` columns. See the migration file's own header comment
for the full reasoning, including why `first_installed_at`, an index, and a
lifecycle RPC were all deliberately left out of this milestone.

## M8.1 end-to-end testing procedure (prepared, not yet executed — pending migration review)

Needs the new lifecycle migration reviewed and pushed
(`pnpm dlx supabase db push`, not run automatically).

### Test A — responsiveness: request-type switching feels instant

Open Create Request, select a few different Request Types in a row.
Verify each switch re-renders the modal with no perceptible delay, and that
Details/Approver survive every switch while type-specific fields
appear/disappear/are dropped exactly per the M8 field matrix.

### Test B — responsiveness: decision submission

Approve or Reject a pending request. Verify the modal closes immediately,
the original message/Request Details view updates shortly after (not
necessarily instantly), and the requester is notified. Compare the felt
latency to before M8.1 if possible.

### Test C — uninstall → app_uninstalled

1. Confirm the existing workspace is `INSTALLED` (`select
   installation_status from workspaces`).
2. Create a request — still works.
3. Uninstall ApproveFlow from Slack's app management page.
4. Confirm `app_uninstalled` arrives and `installation_status` becomes
   `UNINSTALLED`, `uninstalled_at` is set, and all three bot token columns
   are `NULL`.
5. Confirm all historical requests/approvals/users/request types/policies
   are still present and readable.

### Test D — reinstall

6. Reinstall ApproveFlow through the OAuth flow.
7. Confirm the **same** `workspaces.id` row is reused (compare the UUID
   before/after).
8. Confirm a new encrypted bot token is stored, `installation_status` is
   `INSTALLED` again, and `uninstalled_at` is `NULL` again.
9. Confirm Request Center still shows the pre-uninstall history, a new
   request can be created, approval still works, and the requester is
   notified.

### Test E — `tokens_revoked` (best-effort; only if Slack makes this practical to trigger deliberately)

If Slack's app management UI exposes a way to revoke just the bot token
without a full uninstall, trigger it and confirm `installation_status`
becomes `TOKEN_REVOKED`, the token is cleared, new Slack API attempts for
that workspace are safely blocked by the usable-installation guard
(ephemeral "isn't installed right now" message, not a crash), and
historical data remains readable. If Slack provides no practical way to
trigger this deliberately, this test is deferred — the same conservative
matching logic is already exhaustively unit tested in
`compute-installation-transition.test.ts`.

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
        events/route.ts            # POST /api/slack/events — Events API: url_verification, app_home_opened, app_uninstalled, tokens_revoked (M6; extended M8.1); ACKs immediately, all DB/Slack work via after()
        interactions/route.ts      # POST /api/slack/interactions — modal submissions, Approve/Reject, /requests + Home navigation (M8.1: after() for non-trigger_id work, latency instrumentation)
    slack/installed/page.tsx       # OAuth result page
    page.tsx                       # home page (Add to Slack button)
    layout.tsx
  lib/
    env.ts                        # public, client-safe env vars
    env.server.ts                 # server-only env vars (secrets)
    observability/
      timing.ts                   # pure (M8.1): shared structured latency-instrumentation utility (unit tested)
      timing.test.ts
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
      parse-slack-event.ts        # pure (M6, extended M8.1): Events API envelope classifier — url_verification / app_home_opened / app_uninstalled / tokens_revoked / ignored (unit tested)
      parse-slack-event.test.ts
    requests/
      duration-options.ts         # pure: HISTORICAL-ONLY duration label lookup (M8 correction: original M2-M7 scale only, unit tested)
      duration-options.test.ts
      request-timing.ts           # pure (M8 correction): start/end date+time validation + the one shared "When" formatter (unit tested)
      request-timing.test.ts
      request-type-config.ts      # pure (M8 field-matrix correction): centralized per-type field config (TimingMode/expense) + input-preservation remap functions (unit tested)
      request-type-config.test.ts
      expense.ts                  # pure (M8 field-matrix correction): amount/currency validation + the shared "Amount" formatter (unit tested)
      expense.test.ts
      request-types.ts            # server-only: default request types + idempotent seeding (M8: 7 workplace types replace the original 5)
      installation-usability.ts   # pure (M8.1): isUsableInstallation() type guard behind getUsableInstallation() (unit tested)
      installation-usability.test.ts
      compute-installation-transition.ts  # pure (M8.1): app_uninstalled/tokens_revoked lifecycle transition rules (unit tested, no SQL mirror needed — see file header)
      compute-installation-transition.test.ts
      workspace-lookup.ts         # server-only: workspace/user lookup+upsert; M8.1: + getUsableInstallation() centralized guard
      build-request-modal.ts      # pure: request-type-aware Block Kit modal builder, dynamically shaped per TimingMode/expense (M8 field-matrix correction; unit tested)
      build-request-modal.test.ts
      validate-request-submission.ts  # pure: view_submission validation, type-specific per REQUEST_TYPE_FIELD_CONFIG (unit tested; M8 field-matrix correction)
      validate-request-submission.test.ts
      build-approval-notification.ts  # pure: approver DM builder, message update, outcome text (M8: Details terminology, optional Reason; M8 correction: When timing)
      parse-block-action.ts       # pure: block_actions (Approve/Reject) validation — message- and modal-origin (unit tested; M7: now also requires trigger_id)
      parse-block-action.test.ts
      build-decision-modal.ts     # pure (M7): Approve/Reject decision modal builder — optional Comment / required Reason (unit tested)
      build-decision-modal.test.ts
      validate-decision-submission.ts  # pure (M7): decision modal view_submission validation — comment/reason rules (unit tested)
      validate-decision-submission.test.ts
      compute-decision-outcome.ts # pure mirror of decide_on_request()'s algorithm (unit tested; both routing models)
      compute-decision-outcome.test.ts
      build-requester-decision-notification.ts  # pure: final-decision requester DM + notification gating (M7: + comment/reason rendering; M8: Details/When-Duration terminology)
      build-requester-decision-notification.test.ts
      approval-actions.ts         # server-only: decide_on_request() RPC wrapper (M7: + comment param)
      approval-policies.ts        # server-only: active-policy lookup + policy recipient list
      notify-approvers.ts         # server-only: sends DMs to a precomputed recipient list (M8.1: takes an already-usable installation; called via after())
      notify-requester.ts         # server-only: sends the final-decision DM to the requester (M8.1: takes an already-usable installation; called via after())
      status-display.ts           # pure (M5): status emoji + text label (unit tested)
      status-display.test.ts
      parse-requests-action.ts    # pure (M5, extended M6): /requests + Home navigation click validation, incl. views.open vs. views.push origin (unit tested)
      parse-requests-action.test.ts
      build-requests-views.ts     # pure (M5): Request Center / Waiting List / Request Details Block Kit views (unit tested; M8: Details/When-Duration terminology, optional Reason)
      build-requests-views.test.ts
      build-app-home-view.ts      # pure (M6): App Home Block Kit view builder, reuses build-requests-views' row builder (unit tested; M8: updated intro copy)
      build-app-home-view.test.ts
      request-views.ts            # server-only (M5, extended M6/M7): listRequestsByRequester (optional limit), listRequestsWaitingForApprover, getRequestDetails (M7: + approval comment; M8.1: fewer/parallelized round trips in the POLICY branch)
    supabase/
      admin.ts                    # server-only: service-role Supabase client
  types/
    workspace.ts                  # Workspace row type (M8.1: + InstallationStatus, uninstalled_at, nullable token fields)
    request.ts                    # User, RequestType, RequestRow types (incl. M4 routing fields; M8: reason is nullable)
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
    *_add_approval_comment_constraints.sql          # M7 — deployed
    *_update_decide_on_request_for_comment_validation.sql  # M7 — deployed
    *_relax_requests_reason_not_null.sql            # M8 — NOT YET PUSHED, pending review
    *_deactivate_legacy_request_types.sql           # M8 — NOT YET PUSHED, pending review
    *_add_request_timing_fields.sql                 # M8 correction — NOT YET PUSHED, pending review
```
