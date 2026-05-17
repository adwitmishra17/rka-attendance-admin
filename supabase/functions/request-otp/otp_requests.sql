-- OTP store for staff SMS login.
-- One row per phone number; updated in place on each request.
-- Run this in the Supabase SQL editor (rka-attendance project).

create table if not exists public.otp_requests (
  phone        text primary key,           -- as stored in employees.mobile
  otp_hash     text,                       -- HMAC-SHA256 hex; NULL once consumed/expired
  expires_at   timestamptz,                -- OTP validity cutoff (request time + 10 min)
  attempts     int          not null default 0,   -- wrong-code attempts on the current OTP
  send_count   int          not null default 0,   -- OTPs sent in the current rate-limit window
  window_start timestamptz  not null default now(),-- start of the rolling 1-hour window
  last_sent_at timestamptz,                -- used for the per-number send cooldown
  consumed_at  timestamptz,                -- set when an OTP is successfully used
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

-- Lock the table down completely. Only the edge functions touch it, and they
-- use the service-role key, which bypasses RLS. With RLS enabled and no
-- policies, every client (anon/authenticated) is denied all access.
alter table public.otp_requests enable row level security;
