-- Centre Ennajd ERP - Complete SQL Schema with RLS Policies
-- Run this in Supabase SQL Editor

-- Create extension for UUID generation
create extension if not_exists "uuid-ossp";

-- Create extension for row level security
create extension if not_exists "pgcrypto";

-- ============================================================================
-- STUDENTS TABLE
-- ============================================================================

create table students (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  whatsapp_phone text not null,
  parent_phone text not null,
  level text not null check (level in ('T.C', '1Bac', '2Bac', '1Col', '2Col', '3Col')),
  track text check (track in ('s.x', 's.m')),
  enrollments jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  registration_fee jsonb,
  advance_balance integer not null default 0
);

-- Create index for level/track queries
create index idx_students_level_track on students (level, track);

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================

create table sessions (
  id uuid primary key default uuid_generate_v4(),
  subject text not null check (subject in ('Math', 'PC', 'SVT', 'French', 'Arabic', 'SocialStudies', 'IslamicStudies', 'Philosophy', 'English')),
  level text not null check (level in ('T.C', '1Bac', '2Bac', '1Col', '2Col', '3Col')),
  track text check (track in ('s.x', 's.m')),
  group_type text check (group_type in ('Large', 'Small')),
  day_of_week integer not null check (day_of_week >= 0 and day_of_week <= 6),
  start_time text not null,
  end_time text not null,
  teacher_name text,
  kind text default 'recurring' check (kind in ('recurring', 'one_off')),
  date text check (date is null or date like '____-__-__')
);

-- Create index for session lookups
create index idx_sessions_level_subject_track_group on sessions (level, subject, track, group_type);

-- ============================================================================
-- PRICES TABLE
-- ============================================================================

create table prices (
  id uuid primary key default uuid_generate_v4(),
  level text not null,
  subject text not null,
  track text check (track in ('s.x', 's.m')),
  group_type text check (group_type in ('Large', 'Small')),
  price integer not null check (price > 0),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ATTENDANCE RECORDS TABLE
-- ============================================================================

create table attendance_records (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  date text not null,
  status text not null check (status in ('present', 'absent')),
  marked_at timestamptz not null default now(),
  timestamp text not null,
  is_guest boolean default false,
  unique(student_id, session_id, date)
);

-- Create indexes for attendance queries
create index idx_attendance_student_session_date on attendance_records (student_id, session_id, date);

-- Attendance lists + the billing anchor (a student's first PRESENT mark):
-- the monthly attendance report and the reactive ledger recalc both filter
-- by student then date, so this makes them index-only scans.
create index idx_attendance_student_date on attendance_records (student_id, date);
create index idx_attendance_student_status on attendance_records (student_id, status);

-- ============================================================================
-- PAYMENTS TABLE
-- ============================================================================

create table payments (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  subject text not null,
  due_date text not null,
  month text not null,
  is_paid boolean not null default false,
  amount_due integer not null check (amount_due > 0),
  amount_paid integer not null default 0 check (amount_paid >= 0),
  is_half_month boolean not null default false,
  rule text not null check (rule in ('A', 'B')),
  updated_at timestamptz not null default now(),
  unique(student_id, subject, due_date)
);

-- Create indexes for payment queries
create index idx_payments_student_subject_due on payments (student_id, subject, due_date);
create index idx_payments_due_date on payments (due_date);

-- Collection forecast + report lookups: "what does this student owe this
-- month for this subject" is a single index seek (no seq scan on the free
-- tier). Covers the "Paiements à recevoir" worklist and the report matrix.
create index idx_payments_student_month_subject on payments (student_id, month, subject);
create index idx_payments_subject_month on payments (subject, month);

-- Create index for rule filtering
create index idx_payments_rule on payments (rule);

-- Create composite index for outstanding balance queries
create index idx_payments_unpaid_due on payments (is_paid, due_date) where is_paid = false;

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================

create table messages (
  id uuid primary key default uuid_generate_v4(),
  level text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create index for message lookups by level
create index idx_messages_level on messages (level);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
alter table students enable row level security;
alter table sessions enable row level security;
alter table prices enable row level security;
alter table attendance_records enable row level security;
alter table payments enable row level security;
alter table messages enable row level security;

-- Students policies
create policy "authenticated_users_can_read_all_students"
  on students for select
  to authenticated
  using (true);

create policy "authenticated_users_can_insert_students"
  on students for insert
  to authenticated
  with check (true);

create policy "authenticated_users_can_update_students"
  on students for update
  to authenticated
  using (true);

create policy "authenticated_users_can_delete_students"
  on students for delete
  to authenticated
  using (true);

-- Sessions policies
create policy "authenticated_users_can_read_all_sessions"
  on sessions for select
  to authenticated
  using (true);

create policy "authenticated_users_can_insert_sessions"
  on sessions for insert
  to authenticated
  with check (true);

create policy "authenticated_users_can_update_sessions"
  on sessions for update
  to authenticated
  using (true);

create policy "authenticated_users_can_delete_sessions"
  on sessions for delete
  to authenticated
  using (true);

-- Prices policies
create policy "authenticated_users_can_read_all_prices"
  on prices for select
  to authenticated
  using (true);

create policy "authenticated_users_can_insert_prices"
  on prices for insert
  to authenticated
  with check (true);

create policy "authenticated_users_can_update_prices"
  on prices for update
  to authenticated
  using (true);

create policy "authenticated_users_can_delete_prices"
  on prices for delete
  to authenticated
  using (true);

-- Attendance records policies
create policy "authenticated_users_can_read_all_attendance_records"
  on attendance_records for select
  to authenticated
  using (true);

create policy "authenticated_users_can_insert_attendance_records"
  on attendance_records for insert
  to authenticated
  with check (true);

create policy "authenticated_users_can_update_attendance_records"
  on attendance_records for update
  to authenticated
  using (true);

create policy "authenticated_users_can_delete_attendance_records"
  on attendance_records for delete
  to authenticated
  using (true);

-- Payments policies
create policy "authenticated_users_can_read_all_payments"
  on payments for select
  to authenticated
  using (true);

create policy "authenticated_users_can_insert_payments"
  on payments for insert
  to authenticated
  with check (true);

create policy "authenticated_users_can_update_payments"
  on payments for update
  to authenticated
  using (true);

create policy "authenticated_users_can_delete_payments"
  on payments for delete
  to authenticated
  using (true);

-- Messages policies
create policy "authenticated_users_can_read_all_messages"
  on messages for select
  to authenticated
  using (true);

create policy "authenticated_users_can_insert_messages"
  on messages for insert
  to authenticated
  with check (true);

create policy "authenticated_users_can_update_messages"
  on messages for update
  to authenticated
  using (true);

create policy "authenticated_users_can_delete_messages"
  on messages for delete
  to authenticated
  using (true);

-- ============================================================================
-- FUNCTIONS (for timestamps)
-- ============================================================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_messages_updated_at before update on messages
  for each row execute function update_updated_at_column();

create trigger update_students_updated_at before update on students
  for each row execute function update_updated_at_column();