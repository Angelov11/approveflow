import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RequestType } from "@/types/request";

/**
 * Seeded per-workspace the first time a workspace needs them — never a
 * shared/global row. M8: this is the MVP's entire product surface —
 * everyday workplace approvals, not the original AWS-access-shaped set
 * (kept in the database for the workspaces that already used it; see the
 * M8 migration that deactivates those keys going forward — never listed
 * here again, so no newly-installed workspace ever gets them seeded).
 */
export const DEFAULT_REQUEST_TYPES: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  requires_duration: boolean;
}> = [
  {
    key: "vacation_time_off",
    name: "Vacation / Time Off",
    description: "Planned time away from work.",
    requires_duration: true,
  },
  {
    key: "doctor_appointment",
    name: "Doctor Appointment",
    description: "Time away for a medical appointment.",
    requires_duration: true,
  },
  {
    key: "work_from_home",
    name: "Work From Home",
    description: "Working remotely instead of in the office.",
    requires_duration: true,
  },
  {
    key: "personal_time",
    name: "Personal Time",
    description: "Time away for a personal matter.",
    requires_duration: true,
  },
  {
    key: "schedule_change",
    name: "Schedule Change",
    description: "A change to your usual working hours or shift.",
    requires_duration: true,
  },
  {
    key: "expense_purchase",
    name: "Expense / Purchase",
    description: "Approval for a work-related expense or purchase.",
    requires_duration: false,
  },
  {
    key: "other",
    name: "Other Request",
    description: "Anything that doesn't fit the other categories.",
    requires_duration: false,
  },
];

/**
 * Idempotent: inserts any of the default request types that don't already
 * exist for this workspace (ON CONFLICT DO NOTHING on the (workspace_id,
 * key) unique constraint), and never overwrites rows that already exist —
 * so a future admin customization (e.g. deactivating one) is never
 * clobbered by calling this again.
 */
export async function ensureDefaultRequestTypes(workspaceId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("request_types")
    .upsert(
      DEFAULT_REQUEST_TYPES.map((type) => ({ workspace_id: workspaceId, ...type })),
      { onConflict: "workspace_id,key", ignoreDuplicates: true },
    );

  if (error) {
    throw new Error(`Failed to ensure default request types: ${error.message}`);
  }
}

/** Active request types for a workspace, used both to render the modal and to validate a submission's selected key server-side. */
export async function listActiveRequestTypes(workspaceId: string): Promise<RequestType[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("request_types")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list request types: ${error.message}`);
  }
  return data ?? [];
}
