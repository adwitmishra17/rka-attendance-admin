-- ============================================================================
-- 027_document_lock
--
-- Super-admin "lock" on an employee's document set. Once locked, only the
-- super admin (and any users the super admin explicitly allows) may view or
-- download that employee's documents; every other HRMS user sees a
-- "Locked by super admin" message. The teacher's own PWA view is unaffected.
--
-- Lock is per-employee (the whole candidate's document set), managed by the
-- super admin. `documents_lock_allowed` holds the lowercase emails of the
-- additional HRMS users the super admin has granted access to while locked.
-- ============================================================================

alter table public.employees
  add column if not exists documents_locked      boolean     not null default false,
  add column if not exists documents_locked_by   text,
  add column if not exists documents_locked_at   timestamptz,
  add column if not exists documents_lock_allowed text[]     not null default '{}';

comment on column public.employees.documents_locked is
  'When true, only the super admin + emails in documents_lock_allowed may view this employee''s documents in HRMS. The teacher''s own PWA view is unaffected.';
comment on column public.employees.documents_lock_allowed is
  'Lowercase emails of additional HRMS users the super admin allows to view the locked documents.';
