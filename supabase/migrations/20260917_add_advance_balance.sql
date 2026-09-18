-- Migration: add the advance_balance column to students.
--
-- The remote database was deployed before this column existed, so every
-- student insert carrying it failed with PGRST204
-- ("Could not find the 'advance_balance' column of 'students' in the
-- schema cache"). This migration adds the column idempotently and reloads
-- the PostgREST schema cache.
--
-- Run in the Supabase SQL Editor (Dashboard → SQL → New query).

-- 1. Add the missing column (safe to re-run).
alter table students
  add column if not exists advance_balance integer not null default 0;

-- 2. Backfill any NULLs that could exist on legacy rows.
update students set advance_balance = 0 where advance_balance is null;

-- 3. Ask PostgREST to reload its schema cache so the new column is
--    immediately visible to the REST/realtime API. If the notify fails
--    (e.g. pg_notify restricted), ignore it — PostgREST refreshes on its own.
notify pgrst, 'reload schema';
