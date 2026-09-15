import { WebClient } from "@slack/web-api";
import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { buildAppHomeView, HOME_RECENT_REQUESTS_LIMIT } from "@/lib/requests/build-app-home-view";
import { listRequestsByRequester, listRequestsWaitingForApprover } from "@/lib/requests/request-views";
import { findWorkspaceBySlackTeamId, upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { parseSlackEvent, type SlackEventEnvelope } from "@/lib/slack/parse-slack-event";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import { isValidSlackRequest } from "@/lib/slack/verify-request";

const ack = () => new Response(null, { status: 200 });

/**
 * Slack Events API endpoint (M6). Same signing scheme as every other Slack
 * surface (see verify-request.ts) — the url_verification handshake request
 * is signed too, so it's verified here exactly like any other event before
 * ever reading its body.
 *
 * Slack expects a 200 within ~3 seconds and retries delivery on anything
 * else. The only work triggered here is "look up ~3 requests + one waiting
 * count, then republish Home" — small, indexed queries and a single Slack
 * API call, the same synchronous shape as every other route in this app
 * (see /api/slack/commands/request and /commands/requests). That easily
 * fits inside the ack window, so there is no queue, no `waitUntil`/`after`,
 * and nothing pretending to be durable background work that Vercel doesn't
 * actually guarantee. A redelivered event just republishes the same Home
 * view again — views.publish always replaces the prior view wholesale, so
 * a duplicate delivery is a harmless no-op, not a duplicate side effect.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const isValid = isValidSlackRequest({
    signingSecret: serverEnv.SLACK_SIGNING_SECRET ?? "",
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });
  if (!isValid) {
    return new Response("Unauthorized", { status: 401 });
  }

  let envelope: SlackEventEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return ack();
  }

  const parsed = parseSlackEvent(envelope);

  if (parsed.kind === "url_verification") {
    return Response.json({ challenge: parsed.challenge });
  }

  if (parsed.kind === "ignored") {
    return ack();
  }

  // app_home_opened (tab === "home") from here on.
  const workspace = await findWorkspaceBySlackTeamId(parsed.slackTeamId);
  if (!workspace) {
    // Uninstalled, or an event for a team we've never seen — nothing to
    // publish to. Ack anyway so Slack doesn't retry a request we can never
    // satisfy.
    return ack();
  }

  try {
    const viewer = await upsertSlackUser(workspace.id, parsed.slackUserId);

    const [{ rows: recentRequests, totalCount: myRequestsTotalCount }, waitingRequests] = await Promise.all([
      listRequestsByRequester(workspace.id, viewer.id, HOME_RECENT_REQUESTS_LIMIT),
      listRequestsWaitingForApprover(workspace.id, viewer.id),
    ]);

    const view = buildAppHomeView({ recentRequests, myRequestsTotalCount, waitingCount: waitingRequests.length });

    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
    const client = new WebClient(botToken);
    await client.views.publish({ user_id: parsed.slackUserId, view } as Parameters<typeof client.views.publish>[0]);
  } catch (error) {
    // Never log the bot token or raw Slack API response — only a message.
    console.error("Failed to publish App Home view:", error instanceof Error ? error.message : "unknown error");
  }

  return ack();
}
