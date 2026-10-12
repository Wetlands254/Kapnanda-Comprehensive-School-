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

## Bulk learner import and admission numbers
- Sign in with an authorised Supabase staff account, open **Learners**, then choose **Import Learners CSV**.
- Select a CSV containing `admission_number`, `learner_name`, and `grade`; `assessment_number` is optional.
- Review the grade summary and confirm the import. Duplicate admission numbers and likely duplicate learners are checked before anything is saved.
- New ECDE/primary admissions use `KP001`, `KP002`, …; Grades 7–9 use `KJ001`, `KJ002`, … . Numbers continue from the highest existing number for each prefix.
- Keep real learner CSV files out of the public GitHub repository. Select the CSV from your device when importing; the import is processed in the browser and saved through the authenticated Supabase session.

## Supabase
This version is preconfigured for the Kapnanda Supabase project:
- Project: `nrxstipepaevthkeuxoh`
- URL: `https://nrxstipepaevthkeuxoh.supabase.co`

The browser uses the Supabase **publishable/anon key**. Never replace it with a service-role key.

Run `supabase-schema.sql` once in Supabase SQL Editor, then create staff accounts in **Authentication → Users**. Login uses those Supabase Auth email/password accounts.

## GitHub Pages
Upload the project files to the repository root and enable GitHub Pages from the `main` branch.

After deployment, hard-refresh the site once. The app restores an existing Supabase session when possible.
