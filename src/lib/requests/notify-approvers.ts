import "server-only";

import { WebClient } from "@slack/web-api";

import { buildApprovalNotification } from "@/lib/requests/build-approval-notification";
import type { RequestExpense } from "@/lib/requests/expense";
import type { RequestTiming } from "@/lib/requests/request-timing";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import type { Workspace } from "@/types/workspace";

export interface NotificationRecipient {
  slack_user_id: string;
  display_name: string | null;
}

export interface NotifyApproversParams {
  workspace: Workspace;
  requestId: string;
  requestTypeName: string;
  resource: string;
  reason: string | null;
  timing: RequestTiming;
  expense: RequestExpense;
  requester: { slack_user_id: string; display_name: string | null };
  /**
   * Precomputed by the caller (the interactions route): the policy's
   * members for POLICY routing, or the single selected user for DIRECT
   * routing. This module only sends messages — it doesn't know or care
   * which routing mode produced the recipient list, keeping it reusable
   * for both. See src/lib/requests/approval-policies.ts for the policy
   * lookup this used to do internally.
   */
  recipients: NotificationRecipient[];
}

/**
 * Best-effort: a Slack delivery failure here must never affect the
 * already-committed request row. Every failure path below logs a sanitized
 * message and returns rather than throwing, so the caller (the interactions
 * route, right after inserting the request) can't accidentally roll
 * anything back or fail the response to Slack over a notification problem.
 *
 * An empty recipient list (no active policy and no valid direct approver —
 * shouldn't happen given modal validation, but handled defensively) is
 * logged at info level, not as an error: the request is left PENDING
 * rather than silently disappearing or being auto-approved.
 */
export async function notifyApprovers({
  workspace,
  requestId,
  requestTypeName,
  resource,
  reason,
  timing,
  expense,
  requester,
  recipients,
}: NotifyApproversParams): Promise<void> {
  if (recipients.length === 0) {
    console.log(`No approver(s) to notify for request ${requestId} in workspace ${workspace.id} — left PENDING.`);
    return;
  }

  let botToken: string;
  try {
    botToken = decryptBotToken({
      ciphertext: workspace.bot_access_token_ciphertext,
      iv: workspace.bot_access_token_iv,
      authTag: workspace.bot_access_token_auth_tag,
    });
  } catch (error) {
    console.error("Failed to decrypt bot token for approval notification:", error instanceof Error ? error.message : "unknown error");
    return;
  }

  const content = buildApprovalNotification({
    requestId,
    requestTypeName,
    requester,
    resource,
    reason,
    timing,
    expense,
    // Always null here — this function only ever fires for a request just
    // created in this same request cycle (see the interactions route),
    // which by construction has no legacy duration. The historical fallback
    // in buildApprovalNotification exists for rebuildApprovalMessageContent
    // (M7's post-decision message rebuild), not for this initial send.
    legacyDurationMinutes: null,
  });

  const client = new WebClient(botToken);
  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      client.chat.postMessage({ channel: recipient.slack_user_id, ...content } as Parameters<typeof client.chat.postMessage>[0]),
    ),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to notify an approver:", result.reason instanceof Error ? result.reason.message : "unknown error");
    }
  }
}
