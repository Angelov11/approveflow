import { randomUUID } from "node:crypto";

import { WebClient } from "@slack/web-api";
import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { createRequestTimer } from "@/lib/observability/timing";
import { buildRequestModal } from "@/lib/requests/build-request-modal";
import { ensureDefaultRequestTypes, listActiveRequestTypes } from "@/lib/requests/request-types";
import { getUsableInstallation, upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import { isValidSlackRequest } from "@/lib/slack/verify-request";

function ephemeral(text: string) {
  return Response.json({ response_type: "ephemeral", text });
}

/**
 * Slack requires an ack within ~3 seconds, and the `trigger_id` used for
 * `views.open` is only valid for a few seconds after Slack issues it — so
 * everything here (workspace lookup, user upsert, default request types,
 * token decrypt, views.open) happens synchronously in this one request. No
 * background work, no queues: this runs fine as a single Vercel serverless
 * function invocation.
 *
 * M8.1: `upsertSlackUser` (whose result isn't used again in this handler)
 * runs concurrently with the `ensureDefaultRequestTypes` -> `listActiveRequestTypes`
 * chain instead of sequentially before it — that chain itself stays
 * sequential (list must observe whatever ensure just seeded for a brand new
 * workspace's very first command). This trims one DB round trip off the
 * trigger_id-bound path without weakening anything.
 */
export async function POST(request: NextRequest) {
  const timer = createRequestTimer("commands_request", "slash_command");
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

  const form = new URLSearchParams(rawBody);
  const slackTeamId = form.get("team_id");
  const slackUserId = form.get("user_id");
  const triggerId = form.get("trigger_id");
  if (!slackTeamId || !slackUserId || !triggerId) {
    timer.ack("missing_fields");
    return ephemeral("Something went wrong reading that request. Please try again.");
  }

  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    timer.ack("not_installed");
    return ephemeral("ApproveGo isn't installed for this workspace right now. Ask an admin to (re)install it from the ApproveGo home page.");
  }

  try {
    const [, requestTypes] = await timer.time("db", "upsertUser+ensureAndListTypes", () =>
      Promise.all([
        upsertSlackUser(workspace.id, slackUserId),
        (async () => {
          await ensureDefaultRequestTypes(workspace.id);
          return listActiveRequestTypes(workspace.id);
        })(),
      ]),
    );

    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });

    const view = buildRequestModal({ requestTypes, idempotencyKey: randomUUID() });
    const client = new WebClient(botToken);
    await timer.time("slack_api", "views.open", () => client.views.open({ trigger_id: triggerId, view }));
  } catch (error) {
    // Never log the bot token or raw Slack API response — only a message.
    console.error("Failed to open the /request modal:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ephemeral("Something went wrong opening the request form. Please try again.");
  }

  timer.ack("opened");
  // The modal itself is the visible result — nothing more to say here.
  return new Response(null, { status: 200 });
}
