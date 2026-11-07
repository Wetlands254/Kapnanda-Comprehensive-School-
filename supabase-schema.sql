-- ============================================================
-- KAPNANDA PRIMARY AND JUNIOR SCHOOL
-- SUPABASE SCHEMA FOR CURRENT GITHUB APP
-- ============================================================

-- ============================================================
-- SHARED SCHOOL DATA
-- The GitHub app uses this table for learners, teachers,
-- marks, attendance, fees, timetable, settings, etc.
-- ============================================================

create table if not exists public.school_state_shared (
    id text primary key,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table public.school_state_shared
enable row level security;

-- ============================================================
-- REMOVE OLD POLICIES
-- ============================================================

drop policy if exists "school_state_shared_select_auth"
on public.school_state_shared;

drop policy if exists "school_state_shared_insert_auth"
on public.school_state_shared;

drop policy if exists "school_state_shared_update_auth"
on public.school_state_shared;

-- ============================================================
-- LOGGED-IN USERS CAN READ
-- ============================================================

create policy "school_state_shared_select_auth"
on public.school_state_shared
for select
to authenticated
using (true);

-- ============================================================
-- LOGGED-IN USERS CAN INSERT
-- ============================================================

create policy "school_state_shared_insert_auth"
on public.school_state_shared
for insert
to authenticated
with check (true);

-- ============================================================
-- LOGGED-IN USERS CAN UPDATE
-- ============================================================

create policy "school_state_shared_update_auth"
on public.school_state_shared
for update
to authenticated
using (true)
with check (true);

-- ============================================================
-- TABLE PERMISSIONS
-- ============================================================

grant select, insert, update
on public.school_state_shared
to authenticated;

-- ============================================================
-- INITIAL KAPNANDA RECORD
-- ============================================================

insert into public.school_state_shared
(
    id,
    data,
    updated_at
)
values
(
    'KAPNANDA',

    '{
        "settings": {
            "school": "Kapnanda Primary and Junior School",
            "motto": "Learn • Grow • Excel",
            "term": "Term 3",
            "year": "2026"
        },

        "learners": [],
        "teachers": [],
        "teacherLoads": [],
        "payments": [],
        "marks": [],
        "attendance": [],
        "timetable": [],
        "exams": [],
        "audit": [],
        "academicPeriods": [],

        "fees": {
            "byPeriod": {}
        },

        "subjectConfigs": {},

        "timetableMeta": {
            "version": 3
        }
    }'::jsonb,

    now()
)
on conflict (id) do nothing;

-- ============================================================
-- DONE
-- ============================================================


-- ============================================================
-- SAFE CONCURRENT SAVES (MULTIPLE TEACHERS)
-- Run this migration in Supabase SQL Editor after deploying the
-- updated app.js. It performs an atomic compare-and-swap update.
-- A false result means another teacher saved first; the app
-- automatically reloads, merges non-conflicting record changes,
-- and retries.
-- ============================================================

create or replace function public.save_school_state_shared_cas(
  p_id text,
  p_data jsonb,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved_at timestamptz;
  changed integer;
begin
  if p_expected_updated_at is null then
    insert into public.school_state_shared(id, data, updated_at)
    values (p_id, p_data, clock_timestamp())
    on conflict (id) do nothing;
    get diagnostics changed = row_count;
    if changed = 0 then return null; end if;
    select updated_at into saved_at from public.school_state_shared where id = p_id;
    return saved_at;
  end if;

  update public.school_state_shared
     set data = p_data,
         updated_at = clock_timestamp()
   where id = p_id
     and updated_at = p_expected_updated_at
  returning updated_at into saved_at;

  return saved_at;
end;
$$;

grant execute on function public.save_school_state_shared_cas(text, jsonb, timestamptz)
to authenticated;


-- HIGH-CONCURRENCY OPERATION NOTES
-- The application uses an atomic compare-and-swap RPC and retries collisions.
-- For large deployments (50+ concurrent staff), use normalized per-record
-- tables for learners, marks, payments and attendance with unique constraints
-- and UPSERTs keyed by school_id + record_id. A single JSONB school-state row
-- remains a shared serialization point even when CAS prevents lost updates.
