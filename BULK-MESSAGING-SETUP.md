# Bulk SMS + WhatsApp setup (Kapnanda)

The app's **Bulk Messaging** page sends SMS via Africa's Talking and WhatsApp template messages via Meta's official WhatsApp Cloud API. Provider secrets are stored only in Supabase Edge Function secrets; do not paste them into `app.js`, `index.html`, GitHub, or the public SQL file.

## 1. Configure Africa's Talking SMS

1. Create/verify an Africa's Talking account and an SMS application.
2. Confirm Kenyan SMS pricing, permitted use, and whether you need a registered sender ID. A sender ID may require approval/fees.
3. Obtain the production username and API key. Keep them private.

## 2. Configure WhatsApp Cloud API

1. Set up a Meta Business Portfolio and WhatsApp Business Account, register a phone number, and configure the Cloud API.
2. Create and get approval for a template in WhatsApp Manager. This first version expects the template body to contain one text placeholder `{{1}}`.
3. Get a permanent/long-lived access token appropriate for production and the WhatsApp Phone Number ID. Never commit the token.
4. Obtain the required opt-in for parent/guardian messaging. Business-initiated WhatsApp messages must use approved templates; template category and Meta pricing may apply.

## 3. Deploy the Supabase Edge Function

Install and sign in to the Supabase CLI, then from this project folder link your project:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set AFRICASTALKING_USERNAME=YOUR_AT_USERNAME AFRICASTALKING_API_KEY=YOUR_AT_API_KEY
supabase secrets set WHATSAPP_ACCESS_TOKEN=YOUR_META_TOKEN WHATSAPP_PHONE_NUMBER_ID=YOUR_PHONE_NUMBER_ID
# Optional: set a registered sender ID and graph version
supabase secrets set AFRICASTALKING_SENDER_ID=YOUR_APPROVED_SENDER_ID WHATSAPP_GRAPH_VERSION=v23.0
supabase functions deploy send-school-messages
```

Use the actual credentials in your own terminal. Do not put secrets in this document or GitHub. If you do not have a sender ID, omit that secret. Verify the Graph API version supported by your Meta app before production.

The function verifies the caller's Supabase Auth session and limits each campaign to 200 recipients. It normalizes Kenyan phone numbers. The browser still requires a logged-in staff session.

## 4. Prepare parent numbers

Use the new **Parent Contacts** navigation page to review contact coverage and search parents/learners. Choose **Edit contact** to update the parent/guardian name and phone on the learner record. The existing **Phone** field is the linked parent/guardian destination; Kenyan mobile numbers like `0712345678`, `0112345678`, or `+254712345678` are accepted. Invalid or missing numbers are excluded from the preview.

## 5. Send exam result summaries

1. Open **Bulk Messaging**.
2. Choose a channel and class (choose one class at a time for safer checks).
3. Set **Message type** to **Individual exam results** and choose the assessment.
4. Review the recipient count and confirm consent, then send a small test first.

The system creates a personalized result summary for each learner with total marks, average and class position, and sends it only to the phone linked to that learner. The full report card is not attached as a PDF in this version. WhatsApp results require an approved template with one body placeholder (`{{1}}`); the personalized result summary fills that placeholder.

## 6. Test safely before real use

- First test with your own number and a small class.
- Ensure the SMS account has credit and the WhatsApp template is approved and matches the template name/language.
- The WhatsApp template must have one body placeholder (`{{1}}`); the message entered in the app is substituted into that placeholder.
- “Submitted” means the provider accepted the request, not necessarily that it was delivered or read. Check provider delivery reports.
- Check pricing before each campaign. Sending both channels may charge for both.
- Only contact guardians for appropriate school purposes and maintain consent/opt-in and opt-out procedures required by applicable rules and provider policies.

## Limitations of this first version

- Announcement SMS is sent as one Africa's Talking batch request. Personalized exam-result SMS is sent separately per recipient so each parent receives only their learner's result. WhatsApp is sent per recipient.
- WhatsApp currently supports approved templates with exactly one text body variable. It does not attach full PDF report cards or manage template creation, inbound replies, delivery webhooks, opt-outs, or per-recipient audit reports inside the app.
- The app does not store provider credentials. The function requires deployment and secrets configuration before sending can work.
