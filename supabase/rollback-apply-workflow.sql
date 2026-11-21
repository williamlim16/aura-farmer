-- Roll back the apply-workflow tables (feat/apply-engine) ONLY.
-- Leaves the team's tables (post, user_profile, experience, education,
-- resume) and their data untouched. Policies on dropped tables go with them;
-- the resume table's RLS/FK from apply-policies.sql are reverted explicitly.
-- Take a backup first (Supabase Dashboard > Database > Backups).
begin;
drop table if exists "aura-farmer_apply_job_log";
drop table if exists "aura-farmer_apply_job";
drop table if exists "aura-farmer_application";
drop table if exists "aura-farmer_job_posting";
drop table if exists "aura-farmer_candidate_profile";
alter table if exists "aura-farmer_resume" drop constraint if exists "resume_user_fk";
drop policy if exists "resume_select_own" on "aura-farmer_resume";
-- RLS on the team's resume table was enabled by apply-policies.sql; disable only if the team does not rely on it:
-- alter table "aura-farmer_resume" disable row level security;
commit;
