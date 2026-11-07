# Concurrent staff editing and saving

## What changed
- Staff saves send only changed records instead of replacing the entire shared school record.
- Supabase merges each change set atomically through `apply_school_state_patch`.
- Marks are upserted by learner + assessment + subject, avoiding duplicate mark rows when two browsers submit the same mark.
- Learner admission numbers are checked inside the database transaction, so simultaneous registrations cannot create duplicate admission numbers.
- Normal cloud saves no longer wait in a browser-side save queue or use compare-and-swap retry loops.
- Shared updates continue to arrive through the existing refresh cycle.

## Required deployment
1. Back up the Supabase project.
2. Apply migrations `001`–`003` if not already applied.
3. Run `supabase/migrations/202611070004_concurrent_record_patch_saves.sql` in Supabase SQL Editor.
4. Deploy the updated `app.js` with the rest of the project.
5. Sign in from two separate staff accounts/devices and test different subjects, different classes, and learner registration at the same time.
6. Try registering the same admission number from two devices; one submission must be rejected.

## Concurrency model and limitations
The app no longer requires staff to wait for another user's editing session. Each save carries only the changed records, and Supabase merges the changes atomically. PostgreSQL briefly locks the single shared JSONB row while applying a patch; this is a short database transaction. A simultaneous edit to the exact same learner or mark is a conflicting edit and the last committed change wins. Different records do not overwrite each other.

This improves concurrent use without replacing the existing database or migrating the whole school dataset. For very large deployments, normalized tables per learner, mark, payment, and attendance are the next scaling step.

Live multi-device testing still requires applying the migration to the school's Supabase project. Do not treat local source checks as proof of production concurrency.
