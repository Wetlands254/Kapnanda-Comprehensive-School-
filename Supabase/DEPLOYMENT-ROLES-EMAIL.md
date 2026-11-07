Kapnanda deployment checklist — staff roles and parent PDF email

Before applying migrations


Export a backup of school_state_shared and the project files.

List every Supabase Auth staff user and decide whether the account is admin, headteacher, teacher or bursar.

Have the real Auth user UUIDs available.


Apply migration

Run migrations/202611070003_staff_roles_certificates_email.sql in the Supabase SQL Editor as project owner. Then insert role assignments. Example:


insert into public.school_staff_roles(user_id, role, active)
values ('REAL-AUTH-USER-UUID', 'admin', true);

Do not apply the migration without a plan to assign active roles: unassigned users will no longer be able to read or update the school state.


Deploy Edge Function

supabase functions deploy send-parent-document
supabase secrets set RESEND_API_KEY=YOUR_RESEND_KEY
supabase secrets set PARENT_DOCUMENT_FROM_EMAIL=reports@your-verified-domain.example

Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to Edge Functions when configured in the project. Never put service-role credentials in GitHub or browser JavaScript.


Test safely


Use a test learner and a parent mailbox controlled by the school.

Record email consent only after obtaining it.

Email that learner's fee statement and report PDF.

Confirm the attachment belongs to the selected learner.

Confirm a non-consenting learner is rejected.

Confirm an unassigned Auth user is denied.

Check notification_delivery_logs and the Resend dashboard.


A provider API acceptance is not proof of final delivery. Live tests and deployment must be reported separately from local source checks.

