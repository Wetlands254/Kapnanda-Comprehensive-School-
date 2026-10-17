-- TPAD Assistant schema. Run in Supabase SQL Editor.
-- Curriculum rows are shared read-only to signed-in users, and only verified rows are visible.
-- Import curriculum records from the CSV template after checking each row against the official KICD design.

create table if not exists public.tpad_drafts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null, level text not null, period text not null default '',
 section text not null, subject text not null default '', content text not null,
 created_at timestamptz not null default now()
);
alter table public.tpad_drafts enable row level security;
drop policy if exists "Users can read own TPAD drafts" on public.tpad_drafts;
create policy "Users can read own TPAD drafts" on public.tpad_drafts for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert own TPAD drafts" on public.tpad_drafts;
create policy "Users can insert own TPAD drafts" on public.tpad_drafts for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own TPAD drafts" on public.tpad_drafts;
create policy "Users can update own TPAD drafts" on public.tpad_drafts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own TPAD drafts" on public.tpad_drafts;
create policy "Users can delete own TPAD drafts" on public.tpad_drafts for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.tpad_drafts to authenticated;

create table if not exists public.curriculum_items (
 id uuid primary key default gen_random_uuid(),
 school_level text not null check (school_level in ('Primary School','Junior School','Senior School','Special Needs Education')),
 grade text not null,
 subject text not null,
 strand text not null,
 substrand text not null,
 topic text not null default '',
 learning_outcome text not null,
 suggested_learning_experience text not null default '',
 core_competencies text not null default '',
 values text not null default '',
 assessment_guidance text not null default '',
 source_title text not null,
 source_url text not null,
 curriculum_version text not null,
 is_verified boolean not null default false,
 verified_by text not null default '',
 verified_at date,
 created_at timestamptz not null default now(),
 unique (school_level, grade, subject, strand, substrand, topic, learning_outcome, curriculum_version)
);
create index if not exists curriculum_items_lookup_idx on public.curriculum_items (school_level, grade, subject, strand, substrand, topic);
alter table public.curriculum_items enable row level security;
drop policy if exists "Signed-in users can read verified curriculum" on public.curriculum_items;
create policy "Signed-in users can read verified curriculum" on public.curriculum_items for select to authenticated using (is_verified = true);
grant select on public.curriculum_items to authenticated;
-- For data loading: use Supabase Dashboard > Table Editor > curriculum_items > Import data from CSV.
-- Only set is_verified=true after checking the row against the linked official KICD design.
