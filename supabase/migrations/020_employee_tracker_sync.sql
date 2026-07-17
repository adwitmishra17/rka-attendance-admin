-- ============================================================
-- 020_employee_tracker_sync.sql
-- When employees.is_active flips, notify the Tracker (Cloud
-- Function hrmsEmployeeSync) so the Firestore teacher doc is
-- flagged and, on deactivation, their timetable is blanked and
-- class-teacher assignment cleared. Payload carries only the
-- linkage fields (no salary/IDs). Secret lives in this trigger
-- + Google Secret Manager (HRMS_SYNC_SECRET).
-- ============================================================
create extension if not exists pg_net;

create or replace function public.notify_tracker_employee_sync()
returns trigger
language plpgsql
security definer
as $fn$
begin
  perform net.http_post(
    url := 'https://asia-south2-rka-academic-tracker.cloudfunctions.net/hrmsEmployeeSync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hrms-secret', '8fcc1aaa4e40e523c57d73d34f0f8e1977d7e17ec7d8ad38'
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'record', jsonb_build_object(
        'id', new.id, 'full_name', new.full_name, 'email', new.email,
        'personal_email', new.personal_email, 'phone', new.phone,
        'is_active', new.is_active),
      'old_record', jsonb_build_object('is_active', old.is_active)
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$fn$;

drop trigger if exists trg_employee_tracker_sync on public.employees;
create trigger trg_employee_tracker_sync
  after update of is_active on public.employees
  for each row
  when (old.is_active is distinct from new.is_active)
  execute function public.notify_tracker_employee_sync();
