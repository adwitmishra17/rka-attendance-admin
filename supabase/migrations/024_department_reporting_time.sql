-- ============================================================================
-- 024 — Department-wise reporting time
--
-- Adds a per-(branch, department) reporting-time override layer between the
-- branch default (reporting_time_config) and the per-employee custom timing
-- (employees.custom_*). Each override carries a MODE:
--
--   override_custom = false  → "All except custom-timing employees":
--       cascade = employee custom  →  department  →  branch default
--       (an employee with their own custom timing keeps it, fully — including
--        their custom grace, which the resolver previously ignored)
--
--   override_custom = true   → "All employees in the department":
--       cascade = department  →  branch default   (individual custom ignored)
--
-- Any of in_time / out_time / grace_minutes may be NULL to inherit the branch
-- default for that one field. Snapshot semantics are unchanged: only new
-- punches recompute against the new layer; historical attendance_daily rows
-- keep the schedule they were written with.
-- ============================================================================

create table if not exists public.reporting_time_department_config (
  id             uuid primary key default gen_random_uuid(),
  branch_code    text not null,
  department_id  uuid not null references public.departments(id) on delete cascade,
  in_time        time,
  out_time       time,
  grace_minutes  int check (grace_minutes is null or (grace_minutes >= 0 and grace_minutes <= 60)),
  override_custom boolean not null default false,
  updated_at     timestamptz not null default now(),
  updated_by     text,
  unique (branch_code, department_id)
);

alter table public.reporting_time_department_config enable row level security;

-- Mirror reporting_time_config's access: authenticated admins manage it; the
-- resolver (SECURITY DEFINER trigger path) reads it regardless.
drop policy if exists rtdc_read on public.reporting_time_department_config;
create policy rtdc_read on public.reporting_time_department_config
  for select to authenticated using (true);

drop policy if exists rtdc_write on public.reporting_time_department_config;
create policy rtdc_write on public.reporting_time_department_config
  for all to authenticated using (true) with check (true);

create trigger trg_rtdc_updated_at before update on public.reporting_time_department_config
  for each row execute function public.set_updated_at();

-- ── Resolver: slot the department layer into recompute_attendance_daily ──────
create or replace function public.recompute_attendance_daily(p_employee_id uuid, p_date date)
 returns void
 language plpgsql
as $function$
DECLARE
  v_branch_code   text;
  v_in_time       time;
  v_out_time      time;
  v_expected_in   time;
  v_expected_out  time;
  v_grace         int;
  v_sunday_closed boolean;
  v_is_holiday    boolean;
  v_skip_calc     boolean;
  v_dow           text;
BEGIN
  SELECT
    ad.branch_code, ad.in_time, ad.out_time,
    -- Department layer between per-employee custom and the branch default.
    -- override_custom=true → department wins (ignore the employee's custom);
    -- otherwise custom → department → branch. dtc NULL (no override) falls to
    -- the ELSE branch, i.e. the pre-existing custom → branch behaviour.
    CASE WHEN COALESCE(dtc.override_custom, false)
         THEN COALESCE(dtc.in_time,  rtc.default_in_time)
         ELSE COALESCE(e.custom_in_time,  dtc.in_time,  rtc.default_in_time) END,
    CASE WHEN COALESCE(dtc.override_custom, false)
         THEN COALESCE(dtc.out_time, rtc.default_out_time)
         ELSE COALESCE(e.custom_out_time, dtc.out_time, rtc.default_out_time) END,
    CASE WHEN COALESCE(dtc.override_custom, false)
         THEN COALESCE(dtc.grace_minutes, rtc.default_grace_minutes)
         ELSE COALESCE(e.custom_grace_minutes, dtc.grace_minutes, rtc.default_grace_minutes) END,
    rtc.sunday_closed,
    to_char(ad.date, 'FMDay')
  INTO
    v_branch_code, v_in_time, v_out_time,
    v_expected_in, v_expected_out,
    v_grace, v_sunday_closed, v_dow
  FROM attendance_daily ad
  LEFT JOIN employees e               ON e.id            = ad.employee_id
  LEFT JOIN reporting_time_config rtc ON rtc.branch_code = ad.branch_code
  LEFT JOIN reporting_time_department_config dtc
         ON dtc.branch_code = ad.branch_code AND dtc.department_id = e.department_id
  WHERE ad.employee_id = p_employee_id AND ad.date = p_date;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM holidays h
    WHERE ((h.end_date IS NULL AND h.date = p_date)
        OR (h.end_date IS NOT NULL AND p_date BETWEEN h.date AND h.end_date))
      AND (h.branch_code IS NULL OR h.branch_code = v_branch_code)
  ) INTO v_is_holiday;

  v_skip_calc := v_is_holiday
              OR (COALESCE(v_sunday_closed, false) AND v_dow = 'Sunday');

  UPDATE attendance_daily
  SET
    expected_in_time  = v_expected_in,
    expected_out_time = v_expected_out,
    grace_minutes     = v_grace,
    is_holiday        = v_is_holiday,
    late_minutes = CASE
      WHEN v_skip_calc OR v_in_time IS NULL OR v_expected_in IS NULL THEN 0
      ELSE GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (v_in_time - v_expected_in)) / 60)::int - COALESCE(v_grace, 0))
    END,
    early_leave_minutes = CASE
      WHEN v_skip_calc OR v_out_time IS NULL OR v_expected_out IS NULL THEN 0
      ELSE GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (v_expected_out - v_out_time)) / 60)::int - COALESCE(v_grace, 0))
    END,
    updated_at = now()
  WHERE employee_id = p_employee_id AND date = p_date;
END;
$function$;
