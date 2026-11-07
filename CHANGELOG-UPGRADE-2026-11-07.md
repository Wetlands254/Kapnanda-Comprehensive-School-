# Upgrade changelog — 7 November 2026

- Reworked A4 certificate print/export CSS to preserve the designed certificate rather than applying legacy generic sizing.
- Added a formal navy, blue, gold and green leaving certificate design with complete crest/logo containment.
- Added learner admission-date storage and read-only admission/issue dates on the certificate form.
- Added draft vs issued certificate distinction, unique certificate references, issue records and certificate verification/register UI.
- Added duplicate receipt protection and staff/date/method metadata to new fee payments.
- Added notification outcome logging for the existing automatic fee-payment SMS attempt; failed notifications do not reverse saved payments.
- Improved subject option merging to show standard and additional configured active subjects while respecting deactivation.
- Added implementation and test-limit documentation.
- Added optional school logo URL and authorised signatory fields, plus latest recorded assessment details on leaving certificates.
- Added a private SMS/WhatsApp Edge Function deployment directory, separate channel consent checks, and provider delivery-log migration.
- Added database-side duplicate receipt protection for concurrent fee submissions and a fee statement opening balance.
- Added an explicit authorization setting before displaying the Kenya Coat of Arms; school logo is used by default, with a configurable authorized crest image URL.

## Follow-up implementation
- Added parent/guardian email and a distinct email-consent field to learner records.
- Added individual PDF email actions for fee statements and examination reports, using the same A4 PDF rendering path as local downloads.
- Added a server-side Resend Edge Function that revalidates the staff role, learner ownership, parent email and consent before attaching the selected learner's PDF; provider attempts are recorded in the notification log.
- Added staff-role assignments and role-gated RLS for the existing shared-state table. This is coarse-grained because the current schema is a single JSONB row; per-record/per-field isolation remains a migration requirement.
- Added an atomic, database-unique certificate issuance register and changed cloud certificate issuance to use its transaction before presenting an issued certificate.

## Multi-user concurrent staff access
- Added a per-browser cloud-save queue so overlapping local save calls are not dropped.
- Improved CAS retry and merge behaviour for concurrent changes from multiple teacher devices.
- Added natural-key merging for marks and SQL uniqueness checks for admission numbers and learner/exam/subject marks.
- Learner and marks save actions now await cloud confirmation and do not report success when the shared save fails.
- Replaced blocking audit-name prompts with the authenticated staff identity where available.
- Added `MULTI-USER-CONCURRENCY.md` with migration and operational guidance.
