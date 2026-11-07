# Multi-user concurrent staff access

## What changed

- Saves from one browser tab are queued instead of being dropped when another save is in progress.
- Supabase compare-and-swap (CAS) saves retry when another teacher updates the shared school record first.
- Independent learner, teacher, payment, attendance and mark records are merged by record ID so one teacher's save does not replace another teacher's unrelated work.
- Marks are also merged using the natural key `(learner, exam, subject)`. Two teachers entering the same mark at nearly the same time update one mark record instead of creating two.
- Learner registration and marks entry wait for the cloud save result before displaying success. A failed save restores the local records to the previously saved state and asks staff to retry.
- Database-side checks reject simultaneous duplicate admission numbers and duplicate learner/exam/subject marks. Fee receipt uniqueness remains enforced.
- Audit entries identify the signed-in staff account where available; saving no longer interrupts every staff action with a name prompt.

## Deploy the database migration

Apply migrations in order, including the new file:

1. `202611070001_notification_delivery_logs.sql`
2. `202611070002_fee_receipt_uniqueness.sql`
3. `202611070003_staff_roles_certificates_email.sql`
4. `202611070004_concurrent_staff_saves.sql`

Use the Supabase SQL Editor or your normal Supabase migration workflow. Back up the database before applying migrations. The signed-in staff accounts must already have the appropriate active rows in `school_staff_roles`.

## Operational notes

- Each staff member must sign in with their own Supabase Auth account and have an active staff role.
- The browser polls for updates every five seconds. This is near-real-time refresh, not a push notification system.
- A teacher can continue entering marks or registering a learner while another staff member is saving. Supabase still serializes updates to the one shared JSONB row internally; the application handles those brief database-level conflicts automatically. It does not impose a manual “wait for the other teacher” lock.
- If two staff members edit the exact same learner or exact same mark at once, the last accepted edit wins. Avoid editing the same record simultaneously. Independent records and different subjects/classes merge separately.
- This is a concurrency improvement for the current shared-state architecture, not a full normalized-table redesign. For very large schools or heavy simultaneous use, migrate learners, marks, payments and attendance to dedicated relational tables with row-level policies and transactional RPCs.

## Verification

The source-level verification performed for this change includes JavaScript syntax validation and isolated merge tests for independent mark rows, simultaneous new marks with the same natural key, and separate learner registrations. A live multi-device Supabase test must still be performed after applying the migration; no live database credentials or test accounts were available during source packaging.
