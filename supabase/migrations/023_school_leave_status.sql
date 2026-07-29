-- 'school_leave' — a PAID, school-declared day off: the school did not call the
-- employee in on that day and does NOT deduct salary. Distinct from 'on_leave'
-- (the employee's own approved leave). Payroll treats school_leave like a paid
-- day (excluded from the absent count), same as it already ignores holidays.
alter table public.attendance_daily drop constraint attendance_daily_status_check;
alter table public.attendance_daily add constraint attendance_daily_status_check
  check (status = any (array[
    'present', 'late', 'left_early', 'half_day', 'absent',
    'on_leave', 'holiday', 'school_leave'
  ]));
