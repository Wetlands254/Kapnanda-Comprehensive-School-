# A4 print corrections and parent notifications

## A4 documents

Fee Statement, Official Fee Structure and Leaving Certificate now use the same 190 mm inner page width and centred report-style heading. The Kenya crest is rendered at a consistent, larger size. The PDF export stage uses the A4 portrait width and 5 mm PDF margins so the content is not wider than the printable area.

- Print or download using A4, Portrait, 100% / Actual size.
- Turn off browser headers and footers.
- Enable background graphics / print backgrounds to preserve school colours.
- Use the PDF download action where available. Check the downloaded PDF itself, not only the in-app preview.
- A fee statement with many transactions may continue onto a second A4 page; rows are kept together rather than being clipped.
- The fee structure and leaving certificate are designed for one A4 page when their content is within the normal length.

## Automatic fee-payment SMS

The app can submit a payment confirmation SMS after a payment is saved. It is deliberately opt-in, not silently enabled:

1. Apply `supabase/migrations/202611070001_notification_delivery_logs.sql` and `supabase/migrations/202611070002_fee_receipt_uniqueness.sql`, then deploy `supabase/functions/send-school-messages/index.ts` using `supabase functions deploy send-school-messages`.
2. Configure the Africa's Talking secrets as described in `BULK-MESSAGING-SETUP.md`.
3. Open **Parent / Guardian Contacts** and record SMS consent for each parent/guardian who has agreed to receive school SMS. For WhatsApp, record separate WhatsApp consent. Verify the phone number first.
4. Open **School Settings**, enable automatic fee-payment SMS, and save.
5. Make a small test payment against a test learner and confirm the provider accepted the SMS.

The message includes the learner, amount received, receipt number, term/year, total paid and remaining balance. If the provider is not configured or the parent has no valid number/consent, the fee payment is still saved; the app reports that the notification could not be confirmed. A provider acceptance is not proof of delivery. Check Africa's Talking delivery reports and the `notification_delivery_logs` table. The gateway rechecks saved learner contact and consent before sending.

The setting is disabled by default. Consent can be withdrawn from Parent / Guardian Contacts. Do not enable notifications for a learner unless the parent/guardian has agreed.

## Sending report forms and fee statements to parents

The current messaging gateway supports SMS and approved WhatsApp text templates. It can send individual exam-result summaries and fee-payment SMS, but it does **not** currently attach a generated PDF report form or fee statement. Sending those files as attachments requires a secure document-delivery integration (for example, parent email addresses plus a server-side email provider, or private Supabase Storage links and a WhatsApp document workflow). Do not send public links to learner records or put provider secrets in `app.js` or GitHub.

The existing manual **Download PDF** / **Print** actions remain available. The app must not report a PDF as sent until the document has been securely uploaded and the delivery provider confirms acceptance.

## Email delivery of individual PDFs (added 7 November 2026)

The learner record now supports a parent/guardian email address and a separate email-consent flag. The Fee Statement screen and Individual Learner Report screen each have an **Email PDF to Parent** action. The browser renders the same A4 HTML document to a PDF blob and sends that one learner's PDF to the `send-parent-document` Supabase Edge Function. The function rechecks the signed-in staff role, learner ID, registered email address and recorded consent before sending through Resend. It logs the provider response in `notification_delivery_logs`; a provider acceptance is not proof of inbox delivery.

Configure these Supabase Edge Function secrets:

- `RESEND_API_KEY`
- `PARENT_DOCUMENT_FROM_EMAIL` (a verified sender/domain in Resend)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Deploy with `supabase functions deploy send-parent-document`. The PDF is attached to the email; it is not placed at a public URL. Current limit: 9 MB encoded PDF payload. No live Resend test was performed in this development environment.
