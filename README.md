# ApproveFlow

ApproveFlow is a Slack-first approval and access-request application.
Slack users will submit requests (production access, deployment approval,
software access, purchase approval, custom approvals), approvers will
approve/reject them directly in Slack, and ApproveFlow will maintain an
audit trail. Later milestones may integrate with AWS, GitHub, Supabase
auth providers, and Google Workspace to automatically grant/revoke
temporary access.

## Current milestone: M0 — Project Bootstrap

This milestone only sets up the application skeleton: a Next.js app, an
environment configuration layer, the Supabase project structure, the first
database migration (`workspaces`), a health check endpoint, and a minimal
home page.

**Slack functionality is NOT implemented yet.** There is no Slack OAuth, no
slash commands, no event handlers, and no Slack SDK dependency. There is
also no authentication, request/approval workflow, or third-party access
provisioning (AWS/GitHub/etc.) yet — those belong to later milestones.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/) — only needed if you want to run the
  Supabase local stack (`supabase start`)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) —
  can also be run ad-hoc via `pnpm dlx supabase <command>` without a global
  install

## Local setup

```bash
pnpm install
cp .env.example .env.local
# fill in .env.local with your Supabase project values
pnpm dev
```

The app runs at http://localhost:3000.

## pnpm commands

| Command       | Description                          |
| ------------- | ------------------------------------- |
| `pnpm dev`    | Start the Next.js dev server          |
| `pnpm lint`   | Run ESLint                            |
| `pnpm build`  | Type-check and build for production   |
| `pnpm start`  | Run the production build              |

## Environment variables

See `.env.example`. Copy it to `.env.local` for local development —
`.env.local` and all other `.env*` files (except `.env.example`) are
git-ignored and must never contain committed secrets.

| Variable                        | Exposure          | Purpose                                   |
| -------------------------------- | ------------------ | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`       | Public (browser)   | Supabase project URL                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Public (browser)   | Supabase anonymous/public API key          |
| `SUPABASE_SERVICE_ROLE_KEY`      | Server-only, secret | Full-access Supabase key — never expose to client code |

`src/lib/env.ts` exposes the public variables, and `src/lib/env.server.ts`
(guarded by the `server-only` package) exposes the service role key. Any
attempt to import `env.server.ts` from client component code will fail the
build, which is the intended safeguard against leaking the service role key
to the browser.

The health check endpoint (`/api/health`) does not read any Supabase
environment variables and works even if Supabase is not configured.

## Running locally

```bash
pnpm install
pnpm dev
```

Then visit:

- http://localhost:3000 — home page
- http://localhost:3000/api/health — health check, returns
  `{"status":"ok","service":"approveflow"}`

## Lint

```bash
pnpm lint
```

## Build

```bash
pnpm build
```

## Supabase local development

This repo tracks the Supabase **project configuration and migrations only**
(`supabase/config.toml`, `supabase/migrations/`). No project has been
linked or pushed to a remote Supabase instance.

To run Supabase locally (requires Docker):

```bash
pnpm dlx supabase start
```

This spins up a local Postgres instance and applies migrations from
`supabase/migrations/`. To create a new migration:

```bash
pnpm dlx supabase migration new <name>
```

The first migration (`supabase/migrations/*_create_workspaces.sql`) creates
a `workspaces` table — the foundation for multi-tenant Slack workspace
support. It intentionally does **not** store a Slack access token; that
design (encryption, rotation, storage location) is deferred to M1.

## Project structure

```
src/
  app/
    api/health/route.ts   # GET /api/health
    page.tsx              # home page
    layout.tsx
  lib/
    env.ts                # public, client-safe env vars
    env.server.ts         # server-only env vars (service role key)
  types/
    workspace.ts           # Workspace row type

supabase/
  config.toml
  migrations/
    *_create_workspaces.sql
```
