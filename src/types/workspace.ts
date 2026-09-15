/** Row shape of the `workspaces` table (see supabase/migrations). */
export interface Workspace {
  id: string;
  slack_team_id: string;
  name: string | null;
  domain: string | null;
  installed_at: string;
  created_at: string;
  updated_at: string;
}
