# Kapnanda Primary & Junior School Management System

Modern, colourful browser-based school management system for PP1–Grade 9.

## Modules
- Bright modern dashboard with KPIs and optional charts
- Learners
- Teachers and teacher/class/subject assignments
- Marks entry
- Class rankings
- **9-subject performance ranking by class average**
- Learner ranking by overall average, with marks + grades, total, average, grade and position
- Attendance register with Present / Late / Absent controls
- Individual A4 learner reports + PDF option
- School performance analytics
- Fees by academic period
- Smart teacher-aware timetables
- Subject management
- Settings, backup and audit

## Supabase
This version is preconfigured for the Kapnanda Supabase project:
- Project: `nrxstipepaevthkeuxoh`
- URL: `https://nrxstipepaevthkeuxoh.supabase.co`

The browser uses the Supabase **publishable/anon key**. Never replace it with a service-role key.

Run `supabase-schema.sql` once in Supabase SQL Editor, then create staff accounts in **Authentication → Users**. Login uses those Supabase Auth email/password accounts.

## GitHub Pages
Upload the project files to the repository root and enable GitHub Pages from the `main` branch.

After deployment, hard-refresh the site once. The app restores an existing Supabase session when possible.
