-- ============================================================================
-- 025 — Per-DAY reporting-time overrides + whole-day recompute
--
-- "School opens at 9:30 today because of fog" — a single day's reporting
-- time for a branch, overriding EVERY other layer for that date (including
-- per-employee custom timings: a delayed opening applies to everyone).
--
--   resolution per (branch, date):
--     day override  →  [dept override_custom → dept | custom → dept → branch]
--   NULL fields on the override inherit the normal chain for that field.
--
-- Unlike config edits (snapshot-at-write-time), a day override is expected
-- to be applied AFTER punches exist — so recompute_attendance_day() re-runs
-- the resolver for every attendance_daily row of that branch+date and
-- returns how many employees were recalculated. Removing an override and
-- recomputing restores the normal schedule.
-- ============================================================================

create table if not exists public.reporting_time_day_overrides (
  id             uuid primary key default gen_random_uuid(),
  branch_code    text not null,
  date           date not null,
  in_time        time,
  out_time       time,
  grace_minutes  int check (grace_minutes is null or (grace_minutes >= 0 and grace_minutes <= 120)),
  note           text,
  updated_at     timestamptz not null default now(),
  updated_by     text,
  unique (branch_code, date)
);

alter table public.reporting_time_day_overrides enable row level security;

-- Mirror reporting_time_department_config's access (024): authenticated
-- admins manage it; the resolver reads it regardless of caller.
drop policy if exists rtdo_read on public.reporting_time_day_overrides;
create policy rtdo_read on public.reporting_time_day_overrides
  for select to authenticated using (true);

drop policy if exists rtdo_write on public.reporting_time_day_overrides;
create policy rtdo_write on public.reporting_time_day_overrides
  for all to authenticated using (true) with check (true);

create trigger trg_rtdo_updated_at before update on public.reporting_time_day_overrides
  for each row execute function public.set_updated_at();

-- ── Resolver: slot the DAY layer above everything else ───────────────────────
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
    -- Day override first (a special day applies to EVERYONE, custom timings
    -- included); NULL fields fall through to the 024 chain:
    -- dept override_custom=true → dept; else custom → dept → branch.
    COALESCE(dov.in_time,
      CASE WHEN COALESCE(dtc.override_custom, false)
           THEN COALESCE(dtc.in_time,  rtc.default_in_time)
           ELSE COALESCE(e.custom_in_time,  dtc.in_time,  rtc.default_in_time) END),
    COALESCE(dov.out_time,
      CASE WHEN COALESCE(dtc.override_custom, false)
           THEN COALESCE(dtc.out_time, rtc.default_out_time)
           ELSE COALESCE(e.custom_out_time, dtc.out_time, rtc.default_out_time) END),
    COALESCE(dov.grace_minutes,
      CASE WHEN COALESCE(dtc.override_custom, false)
           THEN COALESCE(dtc.grace_minutes, rtc.default_grace_minutes)
           ELSE COALESCE(e.custom_grace_minutes, dtc.grace_minutes, rtc.default_grace_minutes) END),
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
  LEFT JOIN reporting_time_day_overrides dov
         ON dov.branch_code = ad.branch_code AND dov.date = ad.date
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

-- ── Whole-day recompute: re-run the resolver for every employee row of a
--    branch+date; returns how many rows were recalculated. ──────────────────
create or replace function public.recompute_attendance_day(p_branch_code text, p_date date)
 returns integer
 language plpgsql
as $function$
DECLARE
  r RECORD;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT employee_id FROM attendance_daily
    WHERE date = p_date
      AND (p_branch_code IS NULL OR branch_code = p_branch_code)
  LOOP
    PERFORM public.recompute_attendance_daily(r.employee_id, p_date);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;
