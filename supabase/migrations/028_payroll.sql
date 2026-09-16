-- ============================================================
-- 028_payroll.sql
-- RKA HRMS — Payroll.
--
-- Salary structure already lives on employees (basic_salary, hra,
-- other_allowances + pf/esi/uan ids + bank details). This adds:
--   1. per-employee payroll CONFIG on employees (mode + deduction
--      opt-ins + attendance linkage + paid-leave quota),
--   2. payroll_runs (one per branch × month, draft→finalized→paid),
--   3. payroll_items (one frozen line per employee per run).
--
-- Salary ADVANCES are NOT stored here: they already live in SMS
-- (read-only view public.v_salary_advances, surfaced by the Salary
-- Advances page). Payroll recovers against that balance and records
-- the recovered amount per line in payroll_items.advance_recovery;
-- outstanding = sum(SMS advances) − sum(finalized recoveries).
--
-- Everything payroll is service-role only (the admin app uses the
-- service key; RLS + revoke keep anon/authenticated out entirely) —
-- salary data must never be client-readable.
--
-- Idempotent: safe to run more than once (SMS/attendance histories
-- drift, so new DDL is applied directly via `supabase db query`).
-- ============================================================

-- 1) Per-employee payroll configuration -----------------------------------
alter table public.employees
  add column if not exists pay_mode text not null default 'structured'
    check (pay_mode in ('structured', 'fixed')),
  add column if not exists fixed_salary numeric,          -- used when pay_mode='fixed'
  add column if not exists epf_enabled boolean not null default false,
  add column if not exists esi_enabled boolean not null default false,
  add column if not exists lop_enabled boolean not null default true,   -- attendance affects pay
  add column if not exists paid_leaves_per_month numeric not null default 0;

comment on column public.employees.pay_mode is
  'structured = basic+hra+allowances with deductions & LOP per flags; fixed = flat fixed_salary, no auto deductions/LOP.';
comment on column public.employees.lop_enabled is
  'When true (and not attendance_exempt), absences beyond paid_leaves_per_month are docked as Loss of Pay.';

-- 2) Payroll runs (one per branch × month) --------------------------------
create table if not exists public.payroll_runs (
  id            uuid primary key default gen_random_uuid(),
  branch_code   text not null,
  period        text not null,                    -- 'YYYY-MM'
  status        text not null default 'draft' check (status in ('draft', 'finalized', 'paid')),
  working_days  numeric,                           -- working days used for the period (informational; per-day = gross/30)
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    text,
  finalized_at  timestamptz,
  finalized_by  text,
  paid_at       timestamptz,
  paid_by       text,
  unique (branch_code, period)
);

-- 3) Payroll items (frozen per-employee line) -----------------------------
create table if not exists public.payroll_items (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id        uuid not null references public.employees(id),
  -- structure + mode snapshot
  pay_mode           text not null default 'structured',
  basic              numeric not null default 0,
  hra                numeric not null default 0,
  other_allowances   numeric not null default 0,
  gross              numeric not null default 0,
  -- attendance
  working_days       numeric,
  paid_days          numeric,
  lop_days           numeric not null default 0,
  per_day_rate       numeric not null default 0,
  lop_amount         numeric not null default 0,
  -- deductions
  epf                numeric not null default 0,
  esi                numeric not null default 0,
  advance_recovery   numeric not null default 0,
  other_deduction    numeric not null default 0,
  other_deduction_note text,
  total_deductions   numeric not null default 0,
  net_pay            numeric not null default 0,
  -- employer contributions (register only; not deducted from net)
  employer_epf       numeric not null default 0,
  employer_esi       numeric not null default 0,
  -- bank snapshot (as of the run)
  bank_account_number text,
  bank_ifsc          text,
  bank_name          text,
  -- workflow
  is_overridden      boolean not null default false,   -- office manually edited a computed figure
  remarks            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  updated_by         text,
  unique (run_id, employee_id)
);
create index if not exists payroll_items_run_idx on public.payroll_items(run_id);
create index if not exists payroll_items_employee_idx on public.payroll_items(employee_id);

-- 4) Lock it all to service-role (admin app) — no anon/authenticated ------
do $$
declare t text;
begin
  foreach t in array array['payroll_runs', 'payroll_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
