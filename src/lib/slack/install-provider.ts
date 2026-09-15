import "server-only";

import { InstallProvider } from "@slack/oauth";

import { serverEnv } from "@/lib/env.server";
import { deriveOAuthStateSecret } from "@/lib/slack/state-secret";

/**
 * Bot scopes requested during Slack OAuth installation.
 *
 * Keep this to the minimum needed for M1 (installation) plus the one
 * near-term M2 feature we already know is coming. Do not add scopes for
 * features that aren't implemented yet.
 *
 * - `commands` — required to receive the payload for the future `/request`
 *   slash command (M2). No bot scope is strictly required to complete
 *   installation alone, but Slack's OAuth v2 endpoint requires at least one
 *   bot scope to issue a bot token, so we anchor on the scope we already
 *   know we need next rather than requesting something broader "just in
 *   case".
 */
export const SLACK_BOT_SCOPES = ["commands"] as const;

function getAppUrl(): string {
  const appUrl = serverEnv.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL must be set to build Slack OAuth URLs.");
  }
  return appUrl.replace(/\/$/, "");
}

/** The redirect_uri used for both the install and callback legs of OAuth. Must match exactly. */
export function getOAuthRedirectUri(): string {
  return `${getAppUrl()}/api/slack/oauth/callback`;
}

let installer: InstallProvider | undefined;

/**
 * Lazily-constructed singleton. Only `generateInstallUrl()` and `stateStore`
 * are used by this app (see the OAuth routes) — `handleInstallPath()` and
 * `handleCallback()` expect Node's raw `http.IncomingMessage`/`ServerResponse`,
 * which Next.js App Router route handlers (Fetch API Request/Response) don't
 * provide, so those two higher-level helpers aren't used here.
 */
export function getInstaller(): InstallProvider {
  if (installer) {
    return installer;
  }

  const clientId = serverEnv.SLACK_CLIENT_ID;
  const clientSecret = serverEnv.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set to use Slack OAuth.");
  }

  installer = new InstallProvider({
    clientId,
    clientSecret,
    stateSecret: deriveOAuthStateSecret(clientSecret),
  });
  return installer;
}
