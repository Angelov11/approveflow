import { randomUUID } from "node:crypto";

import { WebClient } from "@slack/web-api";
import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { buildRequestModal } from "@/lib/requests/build-request-modal";
import { ensureDefaultRequestTypes, listActiveRequestTypes } from "@/lib/requests/request-types";
import { findWorkspaceBySlackTeamId, upsertSlackUser } from "@/lib/requests/workspace-lookup";
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

  const form = new URLSearchParams(rawBody);
  const slackTeamId = form.get("team_id");
  const slackUserId = form.get("user_id");
  const triggerId = form.get("trigger_id");
  if (!slackTeamId || !slackUserId || !triggerId) {
    return ephemeral("Something went wrong reading that request. Please try again.");
  }

  const workspace = await findWorkspaceBySlackTeamId(slackTeamId);
  if (!workspace) {
    return ephemeral("ApproveFlow isn't installed for this workspace yet. Ask an admin to add it from the ApproveFlow home page.");
  }

  try {
    await upsertSlackUser(workspace.id, slackUserId);
    await ensureDefaultRequestTypes(workspace.id);
    const requestTypes = await listActiveRequestTypes(workspace.id);

    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });

    const view = buildRequestModal({ requestTypes, idempotencyKey: randomUUID() });
    const client = new WebClient(botToken);
    await client.views.open({ trigger_id: triggerId, view });
  } catch (error) {
    // Never log the bot token or raw Slack API response — only a message.
    console.error("Failed to open the /request modal:", error instanceof Error ? error.message : "unknown error");
    return ephemeral("Something went wrong opening the request form. Please try again.");
  }

  // The modal itself is the visible result — nothing more to say here.
  return new Response(null, { status: 200 });
}
