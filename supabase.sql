-- KAPNANDA COMPREHENSIVE SCHOOL MANAGEMENT SYSTEM
-- Shared cloud database for password-free staff access.
-- Run this in Supabase SQL Editor.
-- IMPORTANT: anonymous write/delete access means anyone who can reach the site can modify records.
-- Do NOT put the Supabase service_role key in the website.

create extension if not exists pgcrypto;

create table if not exists public.students (
 id uuid primary key default gen_random_uuid(),
 adm text,
 name text not null,
 gender text,
 class_name text,
 guardian text,
 phone text,
 status text default 'Active',
 created_at timestamptz not null default now()
);
create table if not exists public.teachers (
 id uuid primary key default gen_random_uuid(),
 teacher_id text,
 name text not null,
 subject text,
 phone text,
 status text default 'Active',
 created_at timestamptz not null default now()
);
create table if not exists public.classes (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 stream text,
 teacher text,
 room text,
 created_at timestamptz not null default now()
);
create table if not exists public.attendance (
 id uuid primary key default gen_random_uuid(),
 date date,
 student text,
 status text,
 remarks text,
 created_at timestamptz not null default now()
);
create table if not exists public.fees (
 id uuid primary key default gen_random_uuid(),
 date date,
 student text,
 amount numeric default 0,
 method text,
 reference text,
 created_at timestamptz not null default now()
);
create table if not exists public.results (
 id uuid primary key default gen_random_uuid(),
 date date,
 student text,
 subject text,
 assessment text,
 score numeric,
 grade text,
 created_at timestamptz not null default now()
);
create table if not exists public.users (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 role text,
 phone text,
 status text default 'Active',
 created_at timestamptz not null default now()
);
create table if not exists public.notices (
 id uuid primary key default gen_random_uuid(),
 date date,
 title text,
 message text,
 created_at timestamptz not null default now()
);
create table if not exists public.school_settings (
 id integer primary key,
 settings jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);

alter table public.students enable row level security;
alter table public.teachers enable row level security;
alter table public.classes enable row level security;
alter table public.attendance enable row level security;
alter table public.fees enable row level security;
alter table public.results enable row level security;
alter table public.users enable row level security;
alter table public.notices enable row level security;
alter table public.school_settings enable row level security;

-- Remove/recreate policies so the script can be safely rerun.
do $$
declare t text;
begin
 for t in select unnest(array['students','teachers','classes','attendance','fees','results','users','notices','school_settings'])
 loop
   execute format('drop policy if exists "open_select" on public.%I',t);
   execute format('drop policy if exists "open_insert" on public.%I',t);
   execute format('drop policy if exists "open_update" on public.%I',t);
   execute format('drop policy if exists "open_delete" on public.%I',t);
   execute format('create policy "open_select" on public.%I for select to anon, authenticated using (true)',t);
   execute format('create policy "open_insert" on public.%I for insert to anon, authenticated with check (true)',t);
   execute format('create policy "open_update" on public.%I for update to anon, authenticated using (true) with check (true)',t);
   execute format('create policy "open_delete" on public.%I for delete to anon, authenticated using (true)',t);
 end loop;
end $$;

-- Enable realtime for cross-phone updates.
do $$
begin
  alter publication supabase_realtime add table public.students;
  alter publication supabase_realtime add table public.teachers;
  alter publication supabase_realtime add table public.classes;
  alter publication supabase_realtime add table public.attendance;
  alter publication supabase_realtime add table public.fees;
  alter publication supabase_realtime add table public.results;
  alter publication supabase_realtime add table public.users;
  alter publication supabase_realtime add table public.notices;
exception when duplicate_object then null;
end $$;
