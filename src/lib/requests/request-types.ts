import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RequestType } from "@/types/request";

/** Seeded per-workspace the first time a workspace needs them — never a shared/global row. */
export const DEFAULT_REQUEST_TYPES: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  requires_duration: boolean;
}> = [
  {
    key: "production_access",
    name: "Production Access",
    description: "Temporary access to production systems or data.",
    requires_duration: true,
  },
  {
    key: "deployment_approval",
    name: "Deployment Approval",
    description: "Approval to deploy a change.",
    requires_duration: false,
  },
  {
    key: "software_access",
    name: "Software Access",
    description: "Access to a software tool or service.",
    requires_duration: false,
  },
  {
    key: "purchase_approval",
    name: "Purchase Approval",
    description: "Approval for a purchase or expense.",
    requires_duration: false,
  },
  {
    key: "custom",
    name: "Custom Request",
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
