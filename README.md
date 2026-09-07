# Kapnanda Comprehensive School Management System — Shared Cloud Version

This version is designed for the use case where **Teacher A uses one phone and Teacher B uses another phone**, with both able to add, edit and delete records.

## How it works

1. The website has **no password/login screen**.
2. Each phone loads the same web application.
3. The application connects to the same Supabase project.
4. Students, teachers, classes, attendance, fees, results, users and announcements are stored in Supabase.
5. Supabase Realtime sends database changes to other connected phones.
6. Adding/editing/deleting a record therefore affects the shared school database.

## Setup

### 1. Supabase
Open your Supabase project → SQL Editor → paste and run `supabase.sql`.

### 2. Public connection details
Open `config.js` and set:
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_ANON_KEY` = your public anon key

Never use the `service_role` key in `config.js`.

### 3. GitHub
Upload these files to the same GitHub Pages repository:
- index.html
- app.js
- styles.css
- config.js
- supabase.sql (for reference; it does not need to be public)

### 4. Test
Open the site on Phone A and Phone B.
- Add a student on Phone A.
- Phone B should receive the change automatically.
- Edit/delete from Phone B.
- Phone A should update.

## Important security warning

You requested **no password**. The supplied SQL therefore allows anonymous read/write/delete access. This is intentionally convenient, but it is NOT appropriate for sensitive school records on a public internet site.

For a production school system, the safer approach is:
- no password for ordinary convenience, but
- a trusted access mechanism at the school/network level, or
- staff authentication/roles.

The browser must never contain a Supabase service-role key.
