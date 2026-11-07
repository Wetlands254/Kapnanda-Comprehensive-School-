# Security

- Supabase Authentication controls sign-in.
- The browser contains only the Supabase publishable/anon key.
- Never put a Supabase service-role key in `index.html` or `app.js`.
- Row Level Security protects `school_state_shared` so unauthenticated visitors cannot read or modify the shared school data.
- Create only authorised staff accounts in Supabase Authentication.
- Do not publish real learner data in a public Git repository.

## Known authorization limitation — review before production

The current `school_state_shared` policies authorize **every authenticated account** to read and update the complete shared school JSON record. The current browser app does not yet enforce separate administrator, teacher and bursar permissions. Authentication is not the same as role-based authorization. Keep Supabase accounts restricted to trusted school staff and complete a role-claim/RLS migration before giving accounts to users who should have limited access.

The messaging Edge Function independently verifies the signed-in session, learner-to-phone match and saved SMS/WhatsApp consent before sending. Provider secrets and the service-role key must remain in the Supabase Edge Function runtime only.

## Staff roles and migration (added 7 November 2026)

Apply `supabase/migrations/202611070003_staff_roles_certificates_email.sql` as project owner. Before the restrictive school-state policies take effect, create a `school_staff_roles` row for every existing Supabase Auth staff user. Example (replace the UUID with the real Auth user UUID):

```sql
insert into public.school_staff_roles(user_id, role, active)
values ('00000000-0000-0000-0000-000000000000', 'admin', true)
on conflict (user_id) do update set role=excluded.role, active=true;
```

Allowed roles are `admin`, `headteacher`, `teacher`, and `bursar`. The migration restricts shared-state access to active assigned staff and restricts certificate issuance to administrators/headteachers. It also adds a database-unique certificate register and an atomic issuance RPC.

**Important architecture limitation:** the existing app stores most school records in one shared JSONB row. Role-gated access is an improvement over “all authenticated users”, but it cannot provide per-field or per-learner isolation (for example, a teacher who can update marks can still technically submit changes to other JSON fields). Do not describe this as complete least-privilege authorization. A later normalized-table migration is required before strict teacher-versus-bursar data separation can be guaranteed. Assign roles and test with separate accounts before production rollout.
