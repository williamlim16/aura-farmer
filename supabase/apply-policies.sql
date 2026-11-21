-- Apply workflow: Supabase-specific constraints and row-level security.
-- Run AFTER drizzle/0000_apply_workflow.sql, in the Supabase SQL editor or as
-- a migration. NOT applied anywhere yet (needs project access).
--
-- The app's Drizzle connection is the table owner and bypasses RLS; the app
-- enforces ownership in every query. These policies protect the same tables
-- if they are ever read via supabase-js / PostgREST with a user's JWT.

-- Ownership: tie rows to Supabase users; deleting a user deletes their data.
alter table "aura-farmer_resume"
  add constraint "resume_user_fk" foreign key ("user_id") references auth.users (id) on delete cascade;
alter table "aura-farmer_candidate_profile"
  add constraint "candidate_profile_user_fk" foreign key ("user_id") references auth.users (id) on delete cascade;
alter table "aura-farmer_application"
  add constraint "application_user_fk" foreign key ("user_id") references auth.users (id) on delete cascade;
alter table "aura-farmer_apply_job"
  add constraint "apply_job_user_fk" foreign key ("user_id") references auth.users (id) on delete cascade;

alter table "aura-farmer_resume" enable row level security;
alter table "aura-farmer_candidate_profile" enable row level security;
alter table "aura-farmer_application" enable row level security;
alter table "aura-farmer_apply_job" enable row level security;
alter table "aura-farmer_apply_job_log" enable row level security;

-- Users may read their own rows. All writes go through the server (owner
-- connection), so no insert/update/delete policies are granted to clients.
create policy "resume_select_own" on "aura-farmer_resume"
  for select to authenticated using (user_id = (select auth.uid()));
create policy "candidate_profile_select_own" on "aura-farmer_candidate_profile"
  for select to authenticated using (user_id = (select auth.uid()));
create policy "application_select_own" on "aura-farmer_application"
  for select to authenticated using (user_id = (select auth.uid()));
create policy "apply_job_select_own" on "aura-farmer_apply_job"
  for select to authenticated using (user_id = (select auth.uid()));
create policy "apply_job_log_select_own" on "aura-farmer_apply_job_log"
  for select to authenticated using (
    exists (select 1 from "aura-farmer_apply_job" j where j.id = job_id and j.user_id = (select auth.uid()))
  );
