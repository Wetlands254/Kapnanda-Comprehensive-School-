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
  -- Reject duplicate receipt references atomically, including simultaneous
  -- staff submissions. Historical duplicates already in the row do not block
  -- unrelated saves; the duplicate group must include a newly added payment ID.
  if exists (
    with incoming_payments as (
      select
        payment_json->>'id' as payment_id,
        lower(trim(payment_json->>'receipt')) as receipt,
        exists (
          select 1
          from jsonb_array_elements(
            coalesce((select data->'payments' from public.school_state_shared where id = p_id), '[]'::jsonb)
          ) as old_rows(old_payment)
          where old_rows.old_payment->>'id' = payment_json->>'id'
        ) as existed_before
      from jsonb_array_elements(coalesce(p_data->'payments', '[]'::jsonb)) as incoming_rows(payment_json)
      where nullif(trim(payment_json->>'receipt'), '') is not null
    )
    select 1
    from incoming_payments
    group by receipt
    having count(*) > 1 and bool_or(not existed_before)
  ) then
    raise exception using errcode = '23505', message = 'Duplicate fee receipt/reference number';
  end if;
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

-- ============================================================
-- PRIVATE PARENT MESSAGE DELIVERY LOG
-- Run after reviewing existing RLS policies. Edge Function writes
-- with SUPABASE_SERVICE_ROLE_KEY; authenticated staff may read logs.
-- ============================================================
create table if not exists public.notification_delivery_logs (
  id bigint generated always as identity primary key,
  learner_id text not null,
  recipient_phone text not null,
  channel text not null check (channel in ('sms','whatsapp','email')),
  message_type text not null,
  provider text not null,
  status text not null,
  provider_response jsonb,
  failure_reason text,
  created_at timestamptz not null default now()
);
alter table public.notification_delivery_logs enable row level security;
drop policy if exists "notification_delivery_logs_select_auth" on public.notification_delivery_logs;
create policy "notification_delivery_logs_select_auth"
on public.notification_delivery_logs for select to authenticated using (true);
grant select on public.notification_delivery_logs to authenticated;
revoke insert, update, delete on public.notification_delivery_logs from anon, authenticated;
