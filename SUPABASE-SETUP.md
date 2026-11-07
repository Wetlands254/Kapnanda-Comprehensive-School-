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
