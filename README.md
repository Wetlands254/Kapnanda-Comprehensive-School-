# Kapnanda Primary & Junior School Management System

A clean browser-based school management system for PP1–Grade 9.

## Main modules
- Dashboard
- Learners
- Teachers and teaching assignments
- Marks
- Rankings
- Attendance
- Individual learner reports
- Performance
- Fees
- Timetables
- Subjects
- Settings
- Backup

## Reports
The Reports page supports selecting a Grade/Class first, loading the complete learner list, searching by learner name/admission number, generating an A4 learner report, printing it, and downloading it as PDF.

## Clean starting data
The project contains no learner names, teacher names, marks, fee payments, or previous school records. Add your school's data after deployment.

## Supabase login
The deployed website uses **Supabase Authentication**. There is no hard-coded `admin / Admin123!` login in the live app.

Create the staff/admin account in **Supabase → Authentication → Users**, then sign in on the website using that email and password. Password recovery is handled by Supabase.

Supabase project used by this deployment: `nrxstipepaevthkeuxoh`.

## GitHub Pages
Upload the files in this project to the root of a GitHub repository and enable GitHub Pages from the `main` branch.
