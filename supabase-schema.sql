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
