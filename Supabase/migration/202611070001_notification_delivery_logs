create table if not exists public.notification_delivery_logs (
  id bigint generated always as identity primary key,
  learner_id text not null,
  recipient_phone text not null,
  channel text not null check (channel in ('sms','whatsapp','email')), message_type text not null, provider text not null, status text not null, provider_response jsonb, failure_reason text, created_at timestamptz not null default now() );

alter table public.notification_delivery_logs enable row level security;
drop policy if exists "notification_delivery_logs_select_auth" on public.notification_delivery_logs;
create policy "notification_delivery_logs_select_auth"
  on public.notification_delivery_logs for select to authenticated using (true);
grant select on public.notification_delivery_logs to authenticated;
revoke insert, update, delete on public.notification_delivery_logs from anon, authenticated;
