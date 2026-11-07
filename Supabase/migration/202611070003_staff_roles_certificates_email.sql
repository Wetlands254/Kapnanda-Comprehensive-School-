-- Kapnanda: role-gated access, atomic certificate issuance and email delivery fields.
-- IMPORTANT: create/assign school_staff_roles rows for existing Auth users before
-- enabling the restrictive shared-state policies below. Run as project owner.

create table if not exists public.school_staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','headteacher','teacher','bursar')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.school_staff_roles enable row level security;
drop policy if exists school_staff_roles_self_read on public.school_staff_roles;
create policy school_staff_roles_self_read on public.school_staff_roles
  for select to authenticated using (user_id = auth.uid());
revoke all on public.school_staff_roles from anon, authenticated;
grant select on public.school_staff_roles to authenticated;

create or replace function public.current_school_role()
returns text language sql stable security definer set search_path=public,auth as $$
  select role from public.school_staff_roles where user_id=auth.uid() and active=true limit 1;
$$;
revoke all on function public.current_school_role() from public;
grant execute on function public.current_school_role() to authenticated;

-- The app's current single JSONB record is a coarse-grained data boundary.
-- This migration restricts access to assigned active staff, but cannot enforce
-- per-learner or per-field permissions until records are normalized into tables.
drop policy if exists school_state_shared_select_auth on public.school_state_shared;
drop policy if exists school_state_shared_insert_auth on public.school_state_shared;
drop policy if exists school_state_shared_update_auth on public.school_state_shared;
drop policy if exists school_state_shared_select_staff on public.school_state_shared;
drop policy if exists school_state_shared_insert_admin on public.school_state_shared;
drop policy if exists school_state_shared_update_staff on public.school_state_shared;
create policy school_state_shared_select_staff on public.school_state_shared
  for select to authenticated using (public.current_school_role() in ('admin','headteacher','teacher','bursar'));
create policy school_state_shared_insert_admin on public.school_state_shared
  for insert to authenticated with check (public.current_school_role()='admin');
create policy school_state_shared_update_staff on public.school_state_shared
  for update to authenticated using (public.current_school_role() in ('admin','headteacher','teacher','bursar'))
  with check (public.current_school_role() in ('admin','headteacher','teacher','bursar'));

create table if not exists public.certificate_issues (
  id text primary key,
  certificate_no text not null unique,
  learner_id text not null,
  learner_name text not null,
  admission_number text not null,
  level text not null,
  issue_date timestamptz,
  issued_by uuid references auth.users(id),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
-- Backfill legacy issued certificates so the unique index also protects
-- certificate numbers already present in the shared JSONB register. Legacy
-- rows without a parseable issue timestamp remain in the register with NULL
-- issue_date; their historic date is not fabricated.
insert into public.certificate_issues(id,certificate_no,learner_id,learner_name,admission_number,level,issue_date,issued_by,payload)
select distinct on (upper(trim(c->>'certificateNo')))
  coalesce(nullif(c->>'id',''), 'legacy-' || md5(upper(trim(c->>'certificateNo')))),
  upper(trim(c->>'certificateNo')),
  coalesce(c->>'learnerId','legacy-unknown'),
  coalesce(c->>'learnerName','Legacy learner'),
  coalesce(c->>'admissionNumber',''),
  coalesce(c->>'level',''),
  case
    when coalesce(nullif(c->>'issueDate',''),nullif(c->>'createdAt','')) ~ '^\d{4}-\d{2}-\d{2}'
    then (coalesce(nullif(c->>'issueDate',''),nullif(c->>'createdAt','')))::timestamptz
    else null
  end,
  null,
  c
from public.school_state_shared s
cross join lateral jsonb_array_elements(coalesce(s.data->'certificates','[]'::jsonb)) c
where s.id='KAPNANDA' and nullif(trim(c->>'certificateNo'),'') is not null
order by upper(trim(c->>'certificateNo')), coalesce(c->>'createdAt','') desc
on conflict (certificate_no) do nothing;

alter table public.certificate_issues enable row level security;
drop policy if exists certificate_issues_staff_read on public.certificate_issues;
create policy certificate_issues_staff_read on public.certificate_issues
  for select to authenticated using (public.current_school_role() in ('admin','headteacher','bursar'));
revoke all on public.certificate_issues from anon, authenticated;
grant select on public.certificate_issues to authenticated;

create or replace function public.issue_leaving_certificate(p_certificate jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare c jsonb; saved_at timestamptz;
begin
  if public.current_school_role() not in ('admin','headteacher') then
    raise exception using errcode='42501', message='Only an administrator or headteacher may issue leaving certificates';
  end if;
  if p_certificate is null or nullif(trim(p_certificate->>'certificateNo'),'') is null
     or nullif(trim(p_certificate->>'learnerId'),'') is null
     or nullif(trim(p_certificate->>'learnerName'),'') is null
     or nullif(trim(p_certificate->>'leavingDate'),'') is null then
    raise exception using errcode='22023', message='Certificate payload is incomplete';
  end if;
  c := p_certificate || jsonb_build_object('issuedByUserId',auth.uid()::text,'issueDate',clock_timestamp());
  insert into public.certificate_issues(id,certificate_no,learner_id,learner_name,admission_number,level,issue_date,issued_by,payload)
  values(c->>'id',upper(c->>'certificateNo'),c->>'learnerId',c->>'learnerName',coalesce(c->>'admissionNumber',''),coalesce(c->>'level',''),(c->>'issueDate')::timestamptz,auth.uid(),c);
  update public.school_state_shared
     set data=jsonb_set(data,'{certificates}',coalesce(data->'certificates','[]'::jsonb) || jsonb_build_array(c),true),
         updated_at=clock_timestamp()
   where id='KAPNANDA' returning updated_at into saved_at;
  if saved_at is null then raise exception using errcode='P0002', message='School shared record not found'; end if;
  return jsonb_build_object('certificate',c,'updated_at',saved_at);
end; $$;
revoke all on function public.issue_leaving_certificate(jsonb) from public;
grant execute on function public.issue_leaving_certificate(jsonb) to authenticated;

-- Email recipients and consent live on learner records in the shared state.
alter table public.notification_delivery_logs add column if not exists recipient_email text;
alter table public.notification_delivery_logs alter column recipient_phone drop not null;

-- Restrict delivery log visibility to staff roles that need audit access.
drop policy if exists notification_delivery_logs_select_auth on public.notification_delivery_logs;
drop policy if exists notification_delivery_logs_select_staff on public.notification_delivery_logs;
create policy notification_delivery_logs_select_staff on public.notification_delivery_logs
  for select to authenticated using (public.current_school_role() in ('admin','headteacher','bursar'));
