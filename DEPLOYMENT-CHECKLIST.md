# Deployment Checklist

1. Replace the old GitHub files with all files from this build.
2. In Supabase, run `supabase-schema.sql` if the shared table/policies are not already present.
3. Confirm Supabase Authentication has at least one staff user.
4. Open the GitHub Pages site and sign in with the Supabase Auth email/password.
5. Confirm the **Dashboard loads after login**.
6. Open every sidebar page once: Learners, Teachers, Marks, Rankings, Attendance, Reports, Performance, Fees, Timetables, Subjects and Settings.
7. Add learners and teachers.
8. Configure the active subjects for each class. Junior classes are prepared with 9 default subjects.
9. Create/select an assessment and enter marks.
10. Open Rankings and confirm the subject-performance ranking appears at the top.
11. Print a class ranking in A4 landscape.
12. Generate and print an individual learner report in A4 portrait.
13. Record attendance and confirm it remains after refresh/login.
14. Test a backup before entering live records.
15. Never publish a Supabase service-role key or real learner data in a public repository.
