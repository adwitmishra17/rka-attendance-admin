-- ============================================================
-- 022_employee_transfers.sql
--
-- Employee branch transfers (CITY ⇄ MAIN) with super-admin
-- approval.
--
-- Model: any admin raises a REQUEST (pending); only a super admin
-- approves or rejects (role gating lives app-side, consistent with
-- the app's trust model — every table is writable by authenticated
-- admin sessions). Approval is atomic via apply_employee_transfer():
-- it swaps the branch inside employees.branch_codes and stamps the
-- request in one transaction, so a half-applied transfer can't
-- exist.
--
-- Notes that matter operationally:
--   * Historical attendance_events keep their original branch_code —
--     a transfer never rewrites history.
--   * Future punches attribute to the new branch automatically (the
--     hik receiver reads employees.branch_codes[0]).
--   * Fingerprints are enrolled per physical device: after approval
--     the employee must be enrolled on the destination device (and
--     removed from the source one). The UI reminds the approver.
--   * Biometric code namespaces (MAIN 1–1117, CITY 2018+) are
--     disjoint, so the code travels with the employee unchanged.
--
-- anon gets NOTHING here (PII-adjacent workflow data).
-- Idempotent and safe to re-run.
-- ============================================================

create table if not exists public.employee_transfers (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id) on delete cascade,
  from_branch    text not null,
  to_branch      text not null,
  reason         text,
  effective_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','cancelled')),
  requested_by   text not null,
  requested_at   timestamptz not null default now(),
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,
  applied_at     timestamptz,
  constraint employee_transfers_branches_differ check (to_branch <> from_branch)
);

-- One open request per employee at a time.
create unique index if not exists employee_transfers_one_pending
  on public.employee_transfers (employee_id) where (status = 'pending');
create index if not exists employee_transfers_status_idx
  on public.employee_transfers (status, requested_at desc);

alter table public.employee_transfers enable row level security;

drop policy if exists employee_transfers_admin on public.employee_transfers;
create policy employee_transfers_admin on public.employee_transfers
  for all to authenticated using (true) with check (true);

revoke all on public.employee_transfers from anon;
grant select, insert, update on public.employee_transfers to authenticated;

-- Atomic approval: swap the branch in employees.branch_codes and mark the
-- request approved+applied in one transaction.
create or replace function public.apply_employee_transfer(
  p_transfer_id uuid,
  p_decided_by  text,
  p_note        text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  select * into t
  from public.employee_transfers
  where id = p_transfer_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Transfer % is not pending', p_transfer_id;
  end if;

  update public.employees
  set branch_codes = (
        select coalesce(array_agg(distinct b), array[t.to_branch])
        from unnest(
          array_append(
            array_remove(coalesce(branch_codes, '{}'), t.from_branch),
            t.to_branch
          )
        ) as b
      ),
      updated_at = now(),
      updated_by = p_decided_by
  where id = t.employee_id;

  update public.employee_transfers
  set status = 'approved',
      decided_by = p_decided_by,
      decided_at = now(),
      decision_note = p_note,
      applied_at = now()
  where id = p_transfer_id;
end;
$$;

revoke all on function public.apply_employee_transfer(uuid, text, text) from public, anon;
grant execute on function public.apply_employee_transfer(uuid, text, text) to authenticated, service_role;
