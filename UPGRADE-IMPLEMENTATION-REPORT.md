# Kapnanda School Management System — Upgrade Implementation Report

Date: 7 November 2026
Source: `Kapnanda-A4-Parent-Notifications-Fixed.zip`

## Changes implemented in this source revision

### A4 document export and print
- Kept the existing report-form renderer and the shared `downloadPrintableDocument()` pipeline as the common PDF path.
- Increased PDF raster scale for the one-page leaving certificate and fee structure while retaining a more conservative scale for potentially long documents.
- Reworked the PDF export stage's certificate-specific CSS so the export no longer replaces the certificate's image sizing and layout with the older generic certificate rules.
- Kept A4 portrait jsPDF output, embedded colour preservation, image loading waits, table row break avoidance, and print-window fallback.
- Added a formal A4 leaving-certificate style with navy/royal-blue, gold and green accents, decorative double border, contained school/crest images, and a two-column signature/stamp area.
- Added optional school-logo URL, headteacher name and signatory designation fields to School Settings; certificate academic detail is taken from the latest recorded assessment when available. The Kenya Coat of Arms is now shown only when the school explicitly confirms written authorization; an authorized high-resolution image URL can be configured separately.

### Leaving certificate
- Learner admission date is now an explicit learner-record field. New learner records default to the current date; staff can amend the date in the learner record.
- Certificate admission date is read-only and populated from the learner's saved admission record (legacy records without a date display as unavailable rather than inventing one).
- Leaving date is selected online; issue date is generated from the current date and shown read-only.
- Learner name, admission number, assessment number, class, programme, conduct, activities, remarks, school details, and signatory are populated into the certificate.
- Added a draft PDF action that is clearly labelled as a draft and does not create an issue record.
- Added an explicit **Issue & Download Certificate** operation. It generates a unique reference, records the certificate in `db.certificates`, waits for the existing save operation to succeed, and only then proceeds with PDF generation. A failed save rolls back the local issue record and does not claim issuance.
- Added a searchable-by-number verification operation and issued-certificate register for authenticated staff using the existing school application session.

### Fees
- Payment entry now requires a positive amount and a non-empty receipt/reference number.
- Added an atomic duplicate-receipt guard to the existing compare-and-swap save RPC and migration, so simultaneous staff submissions with the same new receipt reference are rejected by the database.
- Fee statements now calculate and display an opening balance from earlier configured fee periods and payment history.
- Duplicate receipt/reference numbers are rejected before insertion.
- Payment records include the staff account, payment date, method, academic period, and creation timestamp.
- The payment is not announced as saved and no SMS is attempted unless the existing save operation confirms success.
- SMS submission failure is logged in `db.notificationLog` and does not delete or reverse the saved payment.

### Marks subjects
- Subject options for a class/period now include the class's standard catalogue subjects plus additional active configured subjects, while respecting explicit deactivation records. This avoids a partial list when the saved configuration is incomplete.

## Important implementation limits (not represented as completed)

The uploaded archive contained a root `index.ts` messaging gateway but did not place it in the Supabase CLI deployment path. This revision adds `supabase/functions/send-school-messages/index.ts`, keeps the root `index.ts` copy in sync, and adds a private notification delivery-log migration. The function verifies the Supabase staff session, rechecks each recipient against the learner record and the channel-specific consent flag, sends SMS through Africa's Talking or WhatsApp through Meta, and writes provider responses/failures to `notification_delivery_logs`. Delivery is still **not live-tested**; provider secrets, the SQL migration, and Edge Function deployment are required.

The existing embedded Kenya coat-of-arms PNG is only 270 × 227 pixels; it was retained without interpolation rather than misrepresented as a high-resolution asset. Kenya Government branding guidance states that use of the national Coat of Arms by non-government organisations requires Attorney-General authority. The certificate and fee documents therefore use the school logo by default; the national emblem remains hidden unless the authorization checkbox is enabled. Configure a properly licensed, high-resolution image URL if authorized.

The current project still has no email provider integration, private document storage workflow, secure short-lived PDF delivery links, document-attachment delivery, inbound messaging/opt-out webhook, or provider delivery webhook. Individual report-card and fee-statement PDF delivery to parents is therefore not implemented by this revision.

The current database is a single shared JSONB row. Existing RLS permits every authenticated account to read and update that whole row. The app does not currently implement administrator/teacher/bursar role claims or granular record permissions. This revision does not claim to solve that security architecture. Do not expose this deployment to untrusted accounts until role-based authorization and least-privilege RLS are designed and migrated.

Certificate records are stored in the existing shared JSONB school state. The local duplicate check prevents accidental duplicate numbers in the current state, but a database-level unique constraint across simultaneous issuers requires a normalized certificate table and transactional server-side issuance function.

## Validation performed

- `node --check app.js` — passed (JavaScript syntax check).
- `node --check tpad/tpad.js` — passed.
- TypeScript compiler check of the Edge Function body with Deno runtime declarations stubbed — passed; the actual Deno/Supabase CLI runtime is not installed here.
- Isolated logic checks passed for certificate HTML content, fee statement opening-balance calculation, subject catalogue merging/deactivation, payment metadata, and client-side duplicate receipt rejection.
- Source inspection confirmed the original archive had a root messaging TypeScript file but no Supabase Edge Function deployment directory; this revision now adds the expected deployment path and two SQL migrations.
- Static checks confirmed the new certificate and notification collections are included in the shared-state merge/normalization paths.

## Not tested / not claimed

No Supabase credentials or live test tenant were supplied. Chromium browser automation was attempted but the execution environment blocked local web navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`). No real payment was inserted, no SMS/WhatsApp/email was sent, no certificate was issued against a live database, and no live RLS policy was exercised. No Android/desktop print-device test was available in this execution. PDF dimensions and visual page fit therefore still require verification in the deployed browser using actual learner data and the downloaded PDF itself.

## Deployment notes

1. Back up the live `school_state_shared` row and export the existing project before deploying.
2. Upload the updated project files to GitHub Pages.
3. Apply `supabase/migrations/202611070001_notification_delivery_logs.sql` and `supabase/migrations/202611070002_fee_receipt_uniqueness.sql` after reviewing the live schema.
4. Deploy the Edge Function from the project root with `supabase functions deploy send-school-messages`.
5. Configure `AFRICASTALKING_USERNAME` and `AFRICASTALKING_API_KEY` as Supabase secrets. Supabase supplies `SUPABASE_SERVICE_ROLE_KEY` to the Edge Function runtime; never put it in client code. For WhatsApp, also configure `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and optionally `WHATSAPP_GRAPH_VERSION`.
6. Record SMS consent and WhatsApp consent separately in Parent / Guardian Contacts.
7. Test a small SMS campaign with a consenting test parent, then check both the provider dashboard and `notification_delivery_logs`.
8. Test A4 PDFs and print previews on Android and desktop before production use. Do not treat the project as fully production-verified until these tests and role-based RLS work are completed.


## Follow-up changes implemented in this revision

### Parent email PDF delivery
- Added parent/guardian email and separate email-consent fields to learner records.
- Added individual fee-statement and examination-report email actions. The browser creates an A4 PDF blob from the selected learner's own document and sends it as an attachment; it does not email a public document URL.
- Added `supabase/functions/send-parent-document`, which validates the staff session and active assigned staff role, re-reads the learner contact and consent from the authenticated school record, checks the PDF signature and size, sends via Resend, and writes the provider result to the notification delivery log.

### Staff access and certificate issuance
- Added `school_staff_roles` with admin, headteacher, teacher and bursar roles, and role-gated RLS policies for the existing shared school row.
- Added a normalized `certificate_issues` register with a database unique constraint on certificate number.
- Added `issue_leaving_certificate(jsonb)`, a server-side atomic issuance operation that inserts the normalized issue record and appends the certificate payload to the shared school state in one transaction. Cloud issuance now waits for that RPC to succeed before calling the certificate issued.
- Important: the shared school data remains one JSONB row. Role-gated RLS blocks unassigned users, but it cannot restrict teacher/bursar access to individual fields inside the JSON document. Full least-privilege separation requires a future normalized-data migration. Do not treat this as complete role-specific data isolation.

## Follow-up validation
- `node --check app.js` — passed.
- `node --check tpad/tpad.js` — passed.
- TypeScript static check of both Supabase Edge Function sources with Deno runtime declarations stubbed — passed.
- Source inspection confirmed the email action uses the selected learner ID and that the Edge Function independently verifies email address and consent before sending.
- Source inspection confirmed certificate cloud issuance uses the unique database registry RPC.

## Still not tested / not claimed
- SQL migrations were not executed against a live Supabase project; no PostgreSQL server/client is available in this environment.
- No real Resend email, Africa's Talking SMS, or Meta WhatsApp request was sent.
- No live staff-role account matrix or RLS test was possible.
- No browser-based PDF rendering, physical Android/desktop printing, or visual A4 clipping test was possible in this environment.
- No real learner payment, receipt, or certificate transaction was made against the school's live database.

Before production, apply the new migration, assign staff roles, configure the Resend secrets, deploy the Edge Function, and test using controlled test learner/parent accounts. The shared JSONB architecture still requires normalization for strong per-role permissions.
