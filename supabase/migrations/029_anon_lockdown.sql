-- ============================================================
-- 029_anon_lockdown.sql   (supersedes the never-applied 021 draft)
--
-- SECURITY FIX (audit 2026-09-27). The anon key is public by design (it
-- ships in the HRMS and SMS bundles), but anon could:
--   * read EVERY employees column (Aadhaar, PAN, bank, salary, DOB, address);
--   * read all face_embeddings (biometric templates);
--   * insert/update attendance_daily and insert attendance_events (forge
--     attendance → payroll LOP).
-- Those anon grants/policies existed for the face kiosk, which is retired
-- (0 face punches ever; Vercel project deleted). The kiosk wrote via
-- service_role anyway.
--
-- Kept working (verified consumers of the anon key):
--   * HRMS MonthlyReport  employees(id, full_name, biometric_code,
--                          branch_codes, department_id) + is_active filter
--   * HRMS AdvancesReport employees(id, employee_code, designation)
--   * SMS salary-advance picker employees(id, full_name, employee_code,
--                          designation, branch_codes) + is_active
--   * SMS name greeting → now the staff_display_name() RPC below, so
--     email/phone no longer need to be anon-readable.
--   * attendance_daily / attendance_events / holidays / reporting_time_config
--     / vehicles SELECT (HRMS dashboard + reports, SMS vehicle picker).
-- `authenticated` gets the same treatment: HRMS never uses Supabase Auth
-- (0 auth users; sign-up disabled 2026-09-27).
--
-- Idempotent — apply with `supabase db query --linked --yes -f`, never db push.
-- ============================================================

-- 1. employees: column-level SELECT only, no writes.
revoke all on public.employees from anon, authenticated, public;
grant select (id, full_name, employee_code, designation, branch_codes,
              is_active, biometric_code, department_id)
  on public.employees to anon, authenticated;

-- 2. face_embeddings: no client access at all (HRMS uses service_role).
drop policy if exists kiosk_read_active_embeddings on public.face_embeddings;
revoke all on public.face_embeddings from anon, authenticated, public;

-- 3. attendance: read-only for anon; writes only via service_role
--    (hik-punch, recompute_attendance_daily, HRMS admin).
drop policy if exists kiosk_update_daily  on public.attendance_daily;
drop policy if exists kiosk_upsert_daily  on public.attendance_daily;
drop policy if exists kiosk_insert_events on public.attendance_events;
revoke insert, update, delete, truncate, trigger, references
  on public.attendance_daily, public.attendance_events
  from anon, authenticated, public;

-- 4. Reference tables anon only reads: strip write grants.
revoke insert, update, delete, truncate, trigger, references
  on public.holidays, public.vehicles, public.reporting_time_config
  from anon, authenticated, public;

-- 5. Name lookup for the SMS greeting / receipt "Received by".
--    Returns ONLY the full name of an ACTIVE employee matching an email or
--    the last 10 digits of a phone — nothing else leaves the table.
create or replace function public.staff_display_name(p_identifier text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e.full_name
  from public.employees e
  where e.is_active
    and (
      (position('@' in coalesce(p_identifier, '')) > 0
        and lower(e.email) = lower(trim(p_identifier)))
      or
      (position('@' in coalesce(p_identifier, '')) = 0
        and length(regexp_replace(p_identifier, '\D', '', 'g')) between 10 and 15
        and right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10)
            = right(regexp_replace(p_identifier, '\D', '', 'g'), 10))
    )
  order by e.full_name
  limit 1
$$;
revoke all on function public.staff_display_name(text) from public, anon, authenticated;
grant execute on function public.staff_display_name(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
