import { WebClient } from "@slack/web-api";
import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { createRequestTimer } from "@/lib/observability/timing";
import { buildRequestCenterView } from "@/lib/requests/build-requests-views";
import { listRequestsByRequester, listRequestsWaitingForApprover } from "@/lib/requests/request-views";
import { getUsableInstallation, upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import { isValidSlackRequest } from "@/lib/slack/verify-request";

function ephemeral(text: string) {
  return Response.json({ response_type: "ephemeral", text });
}

/**
 * Same timing model as /api/slack/commands/request: Slack needs an ack
 * within ~3 seconds and the trigger_id is only valid for a few seconds, so
 * everything (workspace/user resolution, both list queries, token decrypt,
 * views.open) happens synchronously in this one request — no background
 * work, no queues.
 */
export async function POST(request: NextRequest) {
  const timer = createRequestTimer("commands_requests", "slash_command");
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
    return ephemeral("ApproveFlow isn't installed for this workspace right now. Ask an admin to (re)install it from the ApproveFlow home page.");
  }

  try {
    const user = await timer.time("db", "upsertSlackUser", () => upsertSlackUser(workspace.id, slackUserId));

    const [{ rows: myRequests, totalCount }, waitingRequests] = await timer.time("db", "listRequestsForCenter", () =>
      Promise.all([listRequestsByRequester(workspace.id, user.id), listRequestsWaitingForApprover(workspace.id, user.id)]),
    );

    const view = buildRequestCenterView({
      myRequests,
      myRequestsTotalCount: totalCount,
      waitingCount: waitingRequests.length,
    });

    const botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
    const client = new WebClient(botToken);
    await timer.time("slack_api", "views.open", () => client.views.open({ trigger_id: triggerId, view }));
  } catch (error) {
    // Never log the bot token or raw Slack API response — only a message.
    console.error("Failed to open the /requests view:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ephemeral("Something went wrong opening your requests. Please try again.");
  }

  timer.ack("opened");
  // The modal itself is the visible result — nothing more to say here.
  return new Response(null, { status: 200 });
}
