-- ============================================================
-- 030_firebase_admin_rls.sql  (audit 2026-09-27, item 1 — user-approved 2026-09-28)
--
-- Goal: the HRMS browser app stops using the service_role key. Instead it
-- sends the signed-in admin's FIREBASE ID token as the Supabase access token
-- (Supabase Third-Party Auth → Firebase, project rka-academic-tracker,
-- enabled in the dashboard 2026-09-28). The hrms-claims edge function stamps
-- each active HRMS admin's Firebase user with custom claims:
--     role          = 'authenticated'   (required by Supabase)
--     hrms_level    = 'super_admin' | 'admin' | 'receptionist'
--     hrms_branches = ['MAIN', 'CITY', …]
-- and these policies grant access from those claims.
--
-- Phase 1 = parity with what the UI already allows: any HRMS level gets the
-- HRMS tables; payroll + transfer approval are super-admin only (as in the UI).
-- Branch scoping / receptionist narrowing stay client-side for now.
--
-- Purely additive while the app still uses service_role (which bypasses RLS),
-- so applying this changes nothing for users until the client switch.
-- Idempotent — apply with `supabase db query --linked --yes -f` (never db push).
-- ============================================================

-- 1. Claim helpers (read the verified JWT; no table access).
create or replace function public.hrms_level() returns text
language sql stable set search_path = public as $$
  select nullif(coalesce(auth.jwt() ->> 'hrms_level', ''), '')
$$;
create or replace function public.is_hrms_staff() returns boolean
language sql stable set search_path = public as $$
  select coalesce(public.hrms_level() in ('super_admin', 'admin', 'receptionist'), false)
$$;
create or replace function public.is_hrms_super() returns boolean
language sql stable set search_path = public as $$
  select coalesce(public.hrms_level() = 'super_admin', false)
$$;
grant execute on function public.hrms_level(), public.is_hrms_staff(), public.is_hrms_super()
  to anon, authenticated, service_role;

-- 2. Staff tables: full access for any HRMS level.
do $$
declare t text;
begin
  foreach t in array array[
    'attendance_daily', 'attendance_events', 'candidate_audit_log',
    'candidate_documents', 'candidate_tags', 'candidates', 'departments',
    'driver_documents', 'employee_audit_log', 'employee_documents',
    'employee_transfers', 'employees', 'face_embeddings',
    'fleet_alert_recipients', 'fleet_audit_log', 'holidays',
    'reporting_time_config', 'reporting_time_day_overrides',
    'reporting_time_department_config', 'vehicle_assignments',
    'vehicle_documents', 'vehicles'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists hrms_staff_all on public.%I', t);
    execute format(
      'create policy hrms_staff_all on public.%I for all to authenticated
         using (public.is_hrms_staff()) with check (public.is_hrms_staff())', t);
  end loop;
end $$;

-- Sequences behind serial ids (inserts as authenticated need USAGE).
grant usage, select on all sequences in schema public to authenticated;

-- The view respects the caller's rights (security_invoker) — just needs SELECT.
grant select on public.attendance_counted_employees to authenticated;

-- Old "any authenticated user" policies would OR with the above; drop them.
drop policy if exists employee_transfers_admin on public.employee_transfers;
drop policy if exists rtdo_read  on public.reporting_time_day_overrides;
drop policy if exists rtdo_write on public.reporting_time_day_overrides;
drop policy if exists rtdc_read  on public.reporting_time_department_config;
drop policy if exists rtdc_write on public.reporting_time_department_config;

-- 3. Payroll: super admin only (the UI already restricts it to super_admin).
do $$
declare t text;
begin
  foreach t in array array['payroll_runs', 'payroll_items'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists hrms_super_all on public.%I', t);
    execute format(
      'create policy hrms_super_all on public.%I for all to authenticated
         using (public.is_hrms_super()) with check (public.is_hrms_super())', t);
  end loop;
end $$;

-- 4. Storage buckets the app writes (profile photos stay publicly readable).
drop policy if exists hrms_staff_objects on storage.objects;
create policy hrms_staff_objects on storage.objects for all to authenticated
  using (bucket_id in ('profile-photos', 'candidate-documents', 'face-snapshots')
         and public.is_hrms_staff())
  with check (bucket_id in ('profile-photos', 'candidate-documents', 'face-snapshots')
              and public.is_hrms_staff());

-- 5. recompute_* are SECURITY INVOKER (they run under the caller's RLS);
--    no anonymous calls.
revoke execute on function public.recompute_attendance_daily from public, anon;
revoke execute on function public.recompute_attendance_day from public, anon;
grant execute on function public.recompute_attendance_daily to authenticated, service_role;
grant execute on function public.recompute_attendance_day to authenticated, service_role;

-- 6. Transfer approval is a super-admin decision (UI rule) — enforce it in the
--    SECURITY DEFINER function too. service_role / direct SQL stay allowed.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.apply_employee_transfer(uuid, text, text)'::regprocedure);
  if position('is_hrms_super()' in def) = 0 then
    def := regexp_replace(def, E'\nbegin\n',
      E'\nbegin\n  if coalesce(auth.jwt() ->> ''role'', '''') <> ''service_role''\n     and auth.jwt() is not null and auth.jwt() <> ''{}''::jsonb\n     and not public.is_hrms_super() then\n    raise exception ''Only a super admin can approve transfers'' using errcode = ''42501'';\n  end if;\n', '');
    execute def;
  end if;
end $$;

notify pgrst, 'reload schema';
