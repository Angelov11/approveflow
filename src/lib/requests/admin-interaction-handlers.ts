import { WebClient } from "@slack/web-api";
import { after } from "next/server";

import { deriveBillingSessionSecret } from "../billing/billing-session-secret.ts";
import { createBillingSessionToken } from "../billing/billing-session-token.ts";
import { isBlockedFromNewCheckout } from "../billing/duplicate-subscription-guard.ts";
import { findWorkspaceSubscription } from "../billing/workspace-subscriptions.ts";
import {
  ADD_ADMINISTRATOR_BLOCK_ID,
  ADD_ADMINISTRATOR_SELECT_ACTION_ID,
  buildAddAdministratorModal,
  buildAdminErrorView,
  buildManageAdministratorsView,
} from "./build-admin-views.ts";
import { buildBillingCheckoutModal } from "./build-billing-views.ts";
import { buildPolicyModal, POLICY_APPROVERS_BLOCK_ID } from "./build-policy-modal.ts";
import { buildManagePoliciesView } from "./build-policy-views.ts";
import { serverEnv } from "../env.server.ts";
import type { RequestTimer } from "../observability/timing.ts";
import { configureApprovalPolicy, getPolicyForRequestType, listPolicySummaries } from "./policy-configuration.ts";
import { validatePolicySubmission, type PolicySubmissionPayload } from "./validate-policy-submission.ts";
import { findWorkspaceBySlackTeamId, getUsableInstallation, upsertSlackUser } from "./workspace-lookup.ts";
import { grantWorkspaceAdmin, isWorkspaceAdmin, listWorkspaceAdmins, removeWorkspaceAdmin } from "./workspace-admins.ts";
import { decryptBotToken } from "../slack/token-encryption.ts";
import { getSupabaseAdmin } from "../supabase/admin.ts";
import type { ConfigureApprovalPolicyOutcome } from "../../types/admin.ts";

/**
 * M9 admin/policy interaction handlers, extracted into their own module so
 * interactions/route.ts's existing M1–M8.1 handlers stay untouched — this
 * file is imported and dispatched to exactly like any other handler
 * function, following the same signature convention
 * `(payload, timer) => Promise<Response>`.
 *
 * Every handler here follows the same non-negotiable authorization shape:
 * resolve the workspace and the ACTING slack_user_id from the signed
 * payload envelope (never private_metadata, never a button's `value`),
 * then call isWorkspaceAdmin(workspaceId, actingSlackUserId) and reject
 * (silently ack, or a friendly view_submission error) if false — never
 * trusting that a button being visible/clickable already proved anything.
 */

function modalErrors(errors: Record<string, string>) {
  return Response.json({ response_action: "errors", errors });
}

const ack = () => new Response(null, { status: 200 });

/** Minimal shape shared by the M9 Home/modal block_actions clicks handled here. */
interface AdminBlockActionsPayload {
  type?: string;
  team?: { id?: string };
  user?: { id?: string };
  trigger_id?: string;
  view?: { id?: string; type?: string };
  actions?: { action_id?: string; value?: string }[];
}

async function openView(
  workspace: { bot_access_token_ciphertext: string; bot_access_token_iv: string; bot_access_token_auth_tag: string },
  timer: RequestTimer,
  mode: "open" | "push",
  triggerId: string,
  view: ReturnType<typeof buildAdminErrorView>,
) {
  const botToken = decryptBotToken({
    ciphertext: workspace.bot_access_token_ciphertext,
    iv: workspace.bot_access_token_iv,
    authTag: workspace.bot_access_token_auth_tag,
  });
  const client = new WebClient(botToken);
  if (mode === "push") {
    await timer.time("slack_api", "views.push", () => client.views.push({ trigger_id: triggerId, view } as Parameters<typeof client.views.push>[0]));
  } else {
    await timer.time("slack_api", "views.open", () => client.views.open({ trigger_id: triggerId, view } as Parameters<typeof client.views.open>[0]));
  }
}

// --- Manage Administrators (opened from App Home; trigger_id-bound) ---

export async function handleManageAdministrators(payload: AdminBlockActionsPayload, timer: RequestTimer): Promise<Response> {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  if (!slackTeamId || !slackUserId || !triggerId) {
    timer.ack("ignored");
    return ack();
  }

  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    timer.ack("not_installed");
    return ack();
  }
  if (!(await timer.time("db", "isWorkspaceAdmin", () => isWorkspaceAdmin(workspace.id, slackUserId)))) {
    timer.ack("unauthorized");
    return ack();
  }

  try {
    const admins = await timer.time("db", "listWorkspaceAdmins", () => listWorkspaceAdmins(workspace.id));
    const view = buildManageAdministratorsView(admins.map((a) => ({ slackUserId: a.slackUserId })));
    await openView(workspace, timer, "open", triggerId, view);
  } catch (error) {
    console.error("Failed to open Manage Administrators:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ack();
  }

  timer.ack("opened");
  return ack();
}

// --- Upgrade to Pro (App Home Billing section; trigger_id-bound) ---

/**
 * Never trusts that the Billing button being visible already proved
 * anything — App Home showing "Free" for this viewer could be stale by
 * the time they click. Re-resolves the workspace and re-authorizes via
 * isWorkspaceAdmin() exactly like every other admin action here, THEN
 * re-checks the duplicate-subscription guard fresh (never trusts whatever
 * plan App Home last rendered). Never calls Paddle: this only generates a
 * signed billing-session URL. The Paddle Transaction is created later,
 * server-side, when that URL is opened (see /billing/checkout).
 */
export async function handleUpgradeToPro(payload: AdminBlockActionsPayload, timer: RequestTimer): Promise<Response> {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  if (!slackTeamId || !slackUserId || !triggerId) {
    timer.ack("ignored");
    return ack();
  }

  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    timer.ack("not_installed");
    return ack();
  }
  if (!(await timer.time("db", "isWorkspaceAdmin", () => isWorkspaceAdmin(workspace.id, slackUserId)))) {
    timer.ack("unauthorized");
    return ack();
  }

  try {
    const existingSubscription = await timer.time("db", "findWorkspaceSubscription", () => findWorkspaceSubscription(workspace.id));
    if (isBlockedFromNewCheckout(existingSubscription)) {
      await openView(
        workspace,
        timer,
        "open",
        triggerId,
        buildAdminErrorView("This workspace already has a billing subscription. Billing management will be available here."),
      );
      timer.ack("already_has_subscription");
      return ack();
    }

    const secret = deriveBillingSessionSecret(serverEnv.SLACK_CLIENT_SECRET ?? "");
    const token = createBillingSessionToken({ workspaceId: workspace.id, secret });
    const checkoutUrl = new URL("/billing/checkout", serverEnv.NEXT_PUBLIC_APP_URL);
    checkoutUrl.searchParams.set("session", token);

    await openView(workspace, timer, "open", triggerId, buildBillingCheckoutModal(checkoutUrl.toString()));
  } catch (error) {
    console.error("Failed to open Upgrade to Pro:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ack();
  }

  timer.ack("opened");
  return ack();
}

// --- Add Administrator: open (pushed on top of Manage Administrators; trigger_id-bound) ---

export async function handleAddAdministratorOpen(payload: AdminBlockActionsPayload, timer: RequestTimer): Promise<Response> {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  if (!slackTeamId || !slackUserId || !triggerId) {
    timer.ack("ignored");
    return ack();
  }

  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    timer.ack("not_installed");
    return ack();
  }
  if (!(await timer.time("db", "isWorkspaceAdmin", () => isWorkspaceAdmin(workspace.id, slackUserId)))) {
    timer.ack("unauthorized");
    return ack();
  }

  try {
    await openView(workspace, timer, "push", triggerId, buildAddAdministratorModal());
  } catch (error) {
    console.error("Failed to open Add Administrator:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ack();
  }

  timer.ack("opened");
  return ack();
}

/** Minimal shape of the Add Administrator modal's view_submission. */
interface AddAdministratorSubmissionPayload {
  type?: string;
  team?: { id?: string };
  user?: { id?: string };
  view?: { callback_id?: string; state?: { values?: Record<string, Record<string, { selected_user?: string | null }>> } };
}

/**
 * M9 UX simplification (deliberate): a successful grant just closes this
 * modal — it does NOT attempt to refresh the parent "Manage Administrators"
 * view underneath. Slack's `previous_view_id` mechanism for that exists,
 * but round-tripping through it here would be exactly the kind of
 * elaborate nested-modal synchronization this milestone was told not to
 * chase. Reopening Manage Administrators (from Home) always reflects
 * fresh, authoritative state — that's a sufficient MVP UX.
 */
export async function handleAddAdministratorSubmission(payload: AddAdministratorSubmissionPayload, timer: RequestTimer): Promise<Response> {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!slackTeamId || !slackUserId) {
    timer.ack("missing_identity");
    return modalErrors({ [ADD_ADMINISTRATOR_BLOCK_ID]: "Could not identify the Slack workspace or user. Please try again." });
  }

  const workspace = await timer.time("db", "findWorkspace", () => findWorkspaceBySlackTeamId(slackTeamId));
  if (!workspace) {
    timer.ack("workspace_not_found");
    return modalErrors({ [ADD_ADMINISTRATOR_BLOCK_ID]: "ApproveGo isn't installed for this workspace anymore." });
  }
  if (!(await timer.time("db", "isWorkspaceAdmin", () => isWorkspaceAdmin(workspace.id, slackUserId)))) {
    timer.ack("unauthorized");
    return modalErrors({ [ADD_ADMINISTRATOR_BLOCK_ID]: "Only current administrators can add another administrator." });
  }

  const targetSlackUserId = payload.view?.state?.values?.[ADD_ADMINISTRATOR_BLOCK_ID]?.[ADD_ADMINISTRATOR_SELECT_ACTION_ID]?.selected_user;
  if (!targetSlackUserId) {
    timer.ack("missing_target");
    return modalErrors({ [ADD_ADMINISTRATOR_BLOCK_ID]: "Please select a person." });
  }

  try {
    const actingUser = await timer.time("db", "upsertActingAdmin", () => upsertSlackUser(workspace.id, slackUserId));
    const outcome = await timer.time("db", "grantWorkspaceAdmin", () =>
      grantWorkspaceAdmin({ workspaceId: workspace.id, targetSlackUserId, workspaceBotUserId: workspace.bot_user_id, grantedByUserId: actingUser.id }),
    );
    if (outcome === "bot_rejected") {
      timer.ack("bot_rejected");
      return modalErrors({ [ADD_ADMINISTRATOR_BLOCK_ID]: "That's this workspace's own bot user, not a person — choose someone else." });
    }
    timer.ack(outcome);
  } catch (error) {
    console.error("Failed to grant workspace admin:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return modalErrors({ [ADD_ADMINISTRATOR_BLOCK_ID]: "Something went wrong. Please try again." });
  }

  return ack();
}

// --- Remove Administrator: not trigger_id-bound (views.update on the SAME already-open view) — deferred to after(), M8.1-style ---

export async function handleRemoveAdministrator(payload: AdminBlockActionsPayload, timer: RequestTimer): Promise<Response> {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const viewId = payload.view?.id;
  const targetSlackUserId = payload.actions?.[0]?.value;
  if (!slackTeamId || !slackUserId || !viewId || !targetSlackUserId) {
    timer.ack("ignored");
    return ack();
  }

  after(() =>
    timer.afterTask("removeAdministrator", async () => {
      try {
        const workspace = await getUsableInstallation(slackTeamId);
        if (!workspace) {
          return;
        }
        if (!(await isWorkspaceAdmin(workspace.id, slackUserId))) {
          return;
        }

        const supabase = getSupabaseAdmin();
        const { data: targetUser } = await supabase
          .from("users")
          .select("id")
          .eq("workspace_id", workspace.id)
          .eq("slack_user_id", targetSlackUserId)
          .maybeSingle();

        const outcome = targetUser ? await removeWorkspaceAdmin(workspace.id, targetUser.id) : "not_admin";
        const banner =
          outcome === "last_admin"
            ? "The last administrator can't be removed."
            : outcome === "not_admin"
              ? "That person is already not an administrator."
              : undefined;

        const admins = await listWorkspaceAdmins(workspace.id);
        const view = buildManageAdministratorsView(admins.map((a) => ({ slackUserId: a.slackUserId })), banner);

        const botToken = decryptBotToken({
          ciphertext: workspace.bot_access_token_ciphertext,
          iv: workspace.bot_access_token_iv,
          authTag: workspace.bot_access_token_auth_tag,
        });
        const client = new WebClient(botToken);
        await client.views.update({ view_id: viewId, view } as Parameters<typeof client.views.update>[0]);
      } catch (error) {
        console.error("Failed to process admin removal:", error instanceof Error ? error.message : "unknown error");
      }
    }),
  );

  timer.ack("accepted");
  return ack();
}

// --- Manage Approval Policies (opened from App Home; trigger_id-bound) ---

export async function handleManagePolicies(payload: AdminBlockActionsPayload, timer: RequestTimer): Promise<Response> {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  if (!slackTeamId || !slackUserId || !triggerId) {
    timer.ack("ignored");
    return ack();
  }

  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    timer.ack("not_installed");
    return ack();
  }
  if (!(await timer.time("db", "isWorkspaceAdmin", () => isWorkspaceAdmin(workspace.id, slackUserId)))) {
    timer.ack("unauthorized");
    return ack();
  }

  try {
    const summaries = await timer.time("db", "listPolicySummaries", () => listPolicySummaries(workspace.id));
    await openView(workspace, timer, "open", triggerId, buildManagePoliciesView(summaries));
  } catch (error) {
    console.error("Failed to open Manage Approval Policies:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ack();
  }

  timer.ack("opened");
  return ack();
}

// --- Configure/Edit Policy: open (pushed on top of Manage Approval Policies; trigger_id-bound) ---

export async function handleConfigurePolicyOpen(payload: AdminBlockActionsPayload, timer: RequestTimer): Promise<Response> {
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const triggerId = payload.trigger_id;
  const requestTypeId = payload.actions?.[0]?.value;
  if (!slackTeamId || !slackUserId || !triggerId || !requestTypeId) {
    timer.ack("ignored");
    return ack();
  }

  const workspace = await timer.time("db", "getUsableInstallation", () => getUsableInstallation(slackTeamId));
  if (!workspace) {
    timer.ack("not_installed");
    return ack();
  }
  if (!(await timer.time("db", "isWorkspaceAdmin", () => isWorkspaceAdmin(workspace.id, slackUserId)))) {
    timer.ack("unauthorized");
    return ack();
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: requestType } = await timer.time("db", "getRequestType", async () =>
      supabase.from("request_types").select("id, name, workspace_id, active").eq("id", requestTypeId).maybeSingle(),
    );

    if (!requestType || requestType.workspace_id !== workspace.id || !requestType.active) {
      await openView(workspace, timer, "push", triggerId, buildAdminErrorView("This request type could not be found. Please reopen Manage Approval Policies."));
      timer.ack("invalid_request_type");
      return ack();
    }

    const existing = await timer.time("db", "getPolicyForRequestType", () => getPolicyForRequestType(workspace.id, requestType.id));
    const view = buildPolicyModal({ requestTypeId: requestType.id, requestTypeName: requestType.name, existing: existing ?? undefined });
    await openView(workspace, timer, "push", triggerId, view);
  } catch (error) {
    console.error("Failed to open policy configuration:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return ack();
  }

  timer.ack("opened");
  return ack();
}

function describePolicyOutcome(outcome: ConfigureApprovalPolicyOutcome): string {
  switch (outcome) {
    case "invalid_name":
      return "Something went wrong naming this policy. Please try again.";
    case "invalid_threshold":
      return "Select how many approvals are required.";
    case "invalid_request_type":
      return "This request type could not be verified. Please reopen Manage Approval Policies.";
    case "inactive_request_type":
      return "This request type is no longer active.";
    case "duplicate_approvers":
      return "The same approver was selected more than once.";
    case "no_approvers":
      return "An active policy needs at least one approver.";
    case "threshold_exceeds_approvers":
      return "Required approvals can't exceed the number of selected approvers.";
    case "invalid_approver":
      return "One of the selected approvers could not be verified.";
    case "pro_required":
      return "This workspace needs ApproveGo Pro to activate an approval policy.";
    default:
      return "Something went wrong saving this policy. Please try again.";
  }
}

// --- Policy submission (view_submission) — same "close and let a reopen reflect state" simplification as Add Administrator. ---

export async function handlePolicySubmission(payload: PolicySubmissionPayload, timer: RequestTimer): Promise<Response> {
  const parsed = validatePolicySubmission(payload);
  if (!parsed.ok) {
    timer.ack("validation_error");
    return modalErrors(parsed.errors);
  }
  const { slackTeamId, slackUserId, requestTypeId, approverSlackIds, requiredApprovals, active } = parsed.data;

  const workspace = await timer.time("db", "findWorkspace", () => findWorkspaceBySlackTeamId(slackTeamId));
  if (!workspace) {
    timer.ack("workspace_not_found");
    return modalErrors({ [POLICY_APPROVERS_BLOCK_ID]: "ApproveGo isn't installed for this workspace anymore." });
  }
  if (!(await timer.time("db", "isWorkspaceAdmin", () => isWorkspaceAdmin(workspace.id, slackUserId)))) {
    timer.ack("unauthorized");
    return modalErrors({ [POLICY_APPROVERS_BLOCK_ID]: "Only administrators can configure approval policies." });
  }

  const supabase = getSupabaseAdmin();
  const { data: requestType } = await timer.time("db", "getRequestType", async () =>
    supabase.from("request_types").select("id, name, workspace_id, active").eq("id", requestTypeId).maybeSingle(),
  );
  if (!requestType || requestType.workspace_id !== workspace.id) {
    timer.ack("invalid_request_type");
    return modalErrors({ [POLICY_APPROVERS_BLOCK_ID]: "This request type could not be verified. Please reopen Manage Approval Policies." });
  }
  if (!requestType.active) {
    timer.ack("inactive_request_type");
    return modalErrors({ [POLICY_APPROVERS_BLOCK_ID]: "This request type is no longer active." });
  }

  try {
    const outcome = await timer.time("db", "configureApprovalPolicy", () =>
      configureApprovalPolicy({
        workspaceId: workspace.id,
        requestTypeId: requestType.id,
        requiredApprovals,
        active,
        approverSlackIds,
        policyName: `${requestType.name} Policy`,
      }),
    );
    if (outcome !== "ok") {
      timer.ack(outcome);
      return modalErrors({ [POLICY_APPROVERS_BLOCK_ID]: describePolicyOutcome(outcome) });
    }
  } catch (error) {
    console.error("Failed to configure approval policy:", error instanceof Error ? error.message : "unknown error");
    timer.ack("error");
    return modalErrors({ [POLICY_APPROVERS_BLOCK_ID]: "Something went wrong. Please try again." });
  }

  timer.ack("ok");
  return ack();
}
