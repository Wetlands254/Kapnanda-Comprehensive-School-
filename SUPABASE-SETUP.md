# Supabase Setup — Kapnanda

## 1. Project
Use the Kapnanda project:
`https://nrxstipepaevthkeuxoh.supabase.co`

## 2. Database
Open **SQL Editor** in Supabase and run `supabase-schema.sql`.

The application stores its shared school state in:
`public.school_state_shared`
with record ID:
`KAPNANDA`

## 3. Security
Row Level Security is enabled. The supplied policies allow only authenticated users to read/write the shared school record.

## 4. Staff login
Open **Authentication → Users → Add user** and create an email/password account for each authorised staff member.

There is no `admin / Admin123!` local login in this version.

## 5. GitHub Pages
Upload `index.html`, `style.css`, `app.js` and the SQL/docs files to the repository root. Enable GitHub Pages from `main`.

The public browser key is intentionally in `app.js`; that is normal for a Supabase publishable/anon key. Never put a service-role key in the browser.

## 6. Additional upgrade migrations

For the updated parent messaging and fee duplicate protection, review and apply these migrations to the existing database:

- `supabase/migrations/202611070001_notification_delivery_logs.sql`
- `supabase/migrations/202611070002_fee_receipt_uniqueness.sql`

Deploy the messaging function with `supabase functions deploy send-school-messages` after configuring the provider secrets. See `BULK-MESSAGING-SETUP.md` for the exact environment variables and consent setup.

**Important:** the current shared-state RLS policy gives every authenticated account access to the full school record. Do not interpret this as administrator/teacher/bursar role separation. See `SECURITY.md` before adding staff accounts.
