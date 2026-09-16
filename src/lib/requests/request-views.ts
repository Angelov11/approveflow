import "server-only";

import type { RequestDetailsView, RequestSummary } from "@/lib/requests/build-requests-views";
import { formatAmountLabel } from "@/lib/requests/expense";
import { formatWhenLabel, type RequestTiming } from "@/lib/requests/request-timing";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const MY_REQUESTS_LIMIT = 10;

const REQUEST_SUMMARY_COLUMNS =
  "id, resource, status, requested_duration_minutes, requested_start_date, requested_start_time, requested_end_date, requested_end_time, requested_amount, requested_currency, created_at, request_types(name)";

interface RequestSummaryRow {
  id: string;
  resource: string;
  status: RequestSummary["status"];
  requested_duration_minutes: number | null;
  requested_start_date: string | null;
  requested_start_time: string | null;
  requested_end_date: string | null;
  requested_end_time: string | null;
  requested_amount: number | null;
  requested_currency: string | null;
  created_at: string;
  request_types: { name: string } | { name: string }[] | null;
}

function toSummary(row: RequestSummaryRow): RequestSummary {
  const requestType = Array.isArray(row.request_types) ? row.request_types[0] : row.request_types;
  const timing: RequestTiming = {
    startDate: row.requested_start_date,
    startTime: row.requested_start_time,
    endDate: row.requested_end_date,
    endTime: row.requested_end_time,
  };
  return {
    id: row.id,
    requestTypeName: requestType?.name ?? "Unknown request type",
    resource: row.resource,
    status: row.status,
    whenText: formatWhenLabel(timing, row.requested_duration_minutes)?.value ?? null,
    amountText: formatAmountLabel(row.requested_amount, row.requested_currency),
    createdAt: row.created_at,
  };
}

export interface RequestListResult {
  rows: RequestSummary[];
  totalCount: number;
}

/**
 * Always scoped by BOTH requesterId and workspaceId — never trust one
 * without the other. `limit` defaults to the M5 "/requests" page size;
 * App Home (M6) passes a smaller limit for its compact summary — same
 * query/semantics, just a different requested count, so this stays the
 * single source of truth rather than a second query being written.
 */
export async function listRequestsByRequester(workspaceId: string, requesterId: string, limit: number = MY_REQUESTS_LIMIT): Promise<RequestListResult> {
  const supabase = getSupabaseAdmin();
  const { data, error, count } = await supabase
    .from("requests")
    .select(REQUEST_SUMMARY_COLUMNS, { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("requester_id", requesterId)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);

  if (error) {
    throw new Error(`Failed to list requests by requester: ${error.message}`);
  }
  return { rows: (data ?? []).map(toSummary), totalCount: count ?? 0 };
}

/**
 * "Waiting for me": PENDING requests, scoped to this workspace, where the
 * given user is CURRENTLY authorized to decide — computed with two small
 * targeted queries (DIRECT candidates, then POLICY candidates minus this
 * user's own already-recorded decisions), not by fetching everything and
 * filtering in application code. A policy member who has already decided
 * must not see the request again — matches decide_on_request's own
 * already_decided rule, just read-side.
 */
export async function listRequestsWaitingForApprover(workspaceId: string, userId: string): Promise<RequestSummary[]> {
  const supabase = getSupabaseAdmin();

  const directRequestsPromise = supabase
    .from("requests")
    .select(REQUEST_SUMMARY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("status", "PENDING")
    .eq("routing_type", "DIRECT")
    .eq("direct_approver_id", userId);

  const membershipPromise = supabase.from("approval_policy_members").select("policy_id").eq("user_id", userId);

  const [directResult, membershipResult] = await Promise.all([directRequestsPromise, membershipPromise]);

  if (directResult.error) {
    throw new Error(`Failed to list direct requests waiting for approver: ${directResult.error.message}`);
  }
  if (membershipResult.error) {
    throw new Error(`Failed to look up policy memberships: ${membershipResult.error.message}`);
  }

  const policyIds = (membershipResult.data ?? []).map((row) => row.policy_id);
  let policyRows: RequestSummaryRow[] = [];

  if (policyIds.length > 0) {
    const { data: candidates, error: candidatesError } = await supabase
      .from("requests")
      .select(REQUEST_SUMMARY_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("status", "PENDING")
      .eq("routing_type", "POLICY")
      .in("approval_policy_id", policyIds);

    if (candidatesError) {
      throw new Error(`Failed to list policy requests waiting for approver: ${candidatesError.message}`);
    }

    const candidateIds = (candidates ?? []).map((row) => row.id);
    let alreadyDecidedIds = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: ownDecisions, error: decisionsError } = await supabase
        .from("approvals")
        .select("request_id")
        .eq("approver_id", userId)
        .in("request_id", candidateIds);

      if (decisionsError) {
        throw new Error(`Failed to check existing decisions: ${decisionsError.message}`);
      }
      alreadyDecidedIds = new Set((ownDecisions ?? []).map((row) => row.request_id));
    }

    policyRows = (candidates ?? []).filter((row) => !alreadyDecidedIds.has(row.id));
  }

  const merged = [...(directResult.data ?? []), ...policyRows];
  merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return merged.map(toSummary);
}

/**
 * Requires request.workspace_id === workspaceId — returns null (not an
 * error) for a request that doesn't exist OR belongs to a different
 * workspace, so a caller can never distinguish "wrong workspace" from
 * "doesn't exist" and probe for valid cross-workspace UUIDs.
 */
export async function getRequestDetails(workspaceId: string, requestId: string, viewerUserId: string): Promise<RequestDetailsView | null> {
  const supabase = getSupabaseAdmin();

  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select(
      "id, resource, reason, status, requested_duration_minutes, requested_start_date, requested_start_time, requested_end_date, requested_end_time, requested_amount, requested_currency, created_at, requester_id, routing_type, approval_policy_id, direct_approver_id, request_types(name), users!requests_requester_id_fkey(slack_user_id)",
    )
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (requestError) {
    throw new Error(`Failed to load request details: ${requestError.message}`);
  }
  if (!request) {
    return null;
  }

  const requestType = Array.isArray(request.request_types) ? request.request_types[0] : request.request_types;
  const requester = Array.isArray(request.users) ? request.users[0] : request.users;

  // M8.1: `approver_id` is fetched alongside the existing decision columns
  // specifically so the POLICY branch below can derive "has viewerUserId
  // already decided" from this SAME result, instead of a dedicated extra
  // query (see the removed isCurrentlyAuthorizedForPolicy helper) — trading
  // one extra selected column for one fewer sequential DB round trip on
  // this trigger_id-bound path (View Request).
  const [directApprover, decisionsResult] = await Promise.all([
    request.routing_type === "DIRECT" && request.direct_approver_id
      ? supabase.from("users").select("slack_user_id").eq("id", request.direct_approver_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("approvals")
      .select("approver_id, decision, comment, users(slack_user_id)")
      .eq("request_id", requestId)
      .order("decided_at", { ascending: true }),
  ]);

  if (decisionsResult.error) {
    throw new Error(`Failed to load decisions: ${decisionsResult.error.message}`);
  }

  const decisionRows = decisionsResult.data ?? [];
  const decisions = decisionRows.map((row) => {
    const user = Array.isArray(row.users) ? row.users[0] : row.users;
    return { slackUserId: user?.slack_user_id ?? "unknown", decision: row.decision as "APPROVED" | "REJECTED", comment: row.comment };
  });

  let routing: RequestDetailsView["routing"];
  let canCurrentUserDecide = false;

  if (request.routing_type === "DIRECT") {
    const approverSlackUserId = directApprover?.data?.slack_user_id ?? "unknown";
    routing = { type: "DIRECT", approverSlackUserId };
    canCurrentUserDecide = request.status === "PENDING" && request.direct_approver_id === viewerUserId;
  } else if (request.approval_policy_id) {
    // M8.1: policy + members are independent reads — fetched in parallel
    // instead of sequentially (this branch previously awaited them one
    // after another). "Is viewerUserId currently a member and has NOT
    // already decided" is now derived from this members list plus the
    // decisionRows already fetched above, eliminating the two extra
    // queries isCurrentlyAuthorizedForPolicy used to make.
    const [{ data: policy, error: policyError }, { data: members, error: membersError }] = await Promise.all([
      supabase.from("approval_policies").select("name, required_approvals").eq("id", request.approval_policy_id).maybeSingle(),
      supabase.from("approval_policy_members").select("user_id, users(slack_user_id)").eq("policy_id", request.approval_policy_id),
    ]);
    if (policyError) {
      throw new Error(`Failed to load policy: ${policyError.message}`);
    }
    if (membersError) {
      throw new Error(`Failed to load policy members: ${membersError.message}`);
    }

    const decidedSlackIds = new Set(decisions.map((d) => d.slackUserId));
    const pendingMemberSlackUserIds = (members ?? [])
      .map((row) => (Array.isArray(row.users) ? row.users[0] : row.users)?.slack_user_id)
      .filter((slackId): slackId is string => Boolean(slackId) && !decidedSlackIds.has(slackId));

    routing = {
      type: "POLICY",
      policyName: policy?.name ?? "Unknown policy",
      requiredApprovals: policy?.required_approvals ?? 1,
      pendingMemberSlackUserIds,
    };

    const isMember = (members ?? []).some((row) => row.user_id === viewerUserId);
    const hasAlreadyDecided = decisionRows.some((row) => row.approver_id === viewerUserId);
    canCurrentUserDecide = request.status === "PENDING" && isMember && !hasAlreadyDecided;
  } else {
    // Historical row predating routing snapshots — see the M4 backfill.
    routing = { type: "POLICY_UNAVAILABLE" };
    canCurrentUserDecide = false;
  }

  const timing: RequestTiming = {
    startDate: request.requested_start_date,
    startTime: request.requested_start_time,
    endDate: request.requested_end_date,
    endTime: request.requested_end_time,
  };

  return {
    id: request.id,
    requestTypeName: requestType?.name ?? "Unknown request type",
    resource: request.resource,
    reason: request.reason,
    when: formatWhenLabel(timing, request.requested_duration_minutes),
    amountLabel: formatAmountLabel(request.requested_amount, request.requested_currency),
    status: request.status,
    createdAt: request.created_at,
    requesterSlackUserId: requester?.slack_user_id ?? "unknown",
    routing,
    decisions,
    canCurrentUserDecide,
  };
}
