import "server-only";

import { WebClient } from "@slack/web-api";

import { buildApprovalNotification } from "@/lib/requests/build-approval-notification";
import { formatDurationLabel } from "@/lib/requests/duration-options";
import { decryptBotToken } from "@/lib/slack/token-encryption";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Workspace } from "@/types/workspace";

export interface NotifyApproversParams {
  workspace: Workspace;
  requestId: string;
  requestTypeId: string;
  requestTypeName: string;
  resource: string;
  reason: string;
  requestedDurationMinutes: number | null;
  requester: { slack_user_id: string; display_name: string | null };
}

/**
 * Best-effort: a Slack delivery failure here must never affect the
 * already-committed request row. Every failure path below logs a sanitized
 * message and returns rather than throwing, so the caller (the interactions
 * route, right after inserting the request) can't accidentally roll
 * anything back or fail the response to Slack over a notification problem.
 *
 * "No active policy" is an expected, valid state in M3 (see the M3 report/
 * README) — logged at info level, not as an error.
 */
export async function notifyApprovers({
  workspace,
  requestId,
  requestTypeId,
  requestTypeName,
  resource,
  reason,
  requestedDurationMinutes,
  requester,
}: NotifyApproversParams): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: policy, error: policyError } = await supabase
    .from("approval_policies")
    .select("id, required_approvals")
    .eq("workspace_id", workspace.id)
    .eq("request_type_id", requestTypeId)
    .eq("active", true)
    .maybeSingle();

  if (policyError) {
    console.error("Failed to look up approval policy:", policyError.message);
    return;
  }
  if (!policy) {
    console.log(
      `No active approval policy for request type ${requestTypeId} in workspace ${workspace.id} — request ${requestId} left PENDING with no notification.`,
    );
    return;
  }

  const { data: members, error: membersError } = await supabase
    .from("approval_policy_members")
    .select("users(slack_user_id, display_name)")
    .eq("policy_id", policy.id);

  if (membersError) {
    console.error("Failed to look up approval policy members:", membersError.message);
    return;
  }
  if (!members || members.length === 0) {
    console.log(`Approval policy ${policy.id} has no members — request ${requestId} left PENDING with no notification.`);
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
    durationLabel: formatDurationLabel(requestedDurationMinutes),
  });

  const client = new WebClient(botToken);
  const results = await Promise.allSettled(
    members.map((member) => {
      const user = Array.isArray(member.users) ? member.users[0] : member.users;
      if (!user) {
        return Promise.resolve();
      }
      return client.chat.postMessage(
        { channel: user.slack_user_id, ...content } as Parameters<typeof client.chat.postMessage>[0],
      );
    }),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        "Failed to notify an approver:",
        result.reason instanceof Error ? result.reason.message : "unknown error",
      );
    }
  }
}
