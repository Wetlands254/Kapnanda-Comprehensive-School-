# Deployment Checklist

1. Replace the old GitHub files with all files from this build.
2. In Supabase, run `supabase-schema.sql` if the shared table/policies are not already present.
3. Confirm Supabase Authentication has at least one staff user.
4. Open the GitHub Pages site and sign in with the Supabase Auth email/password.
5. Confirm the **Dashboard loads after login**.
6. Open every sidebar page once: Learners, Teachers, Marks, Rankings, Attendance, Reports, Performance, Fees, Timetables, Subjects and Settings.
7. Add learners and teachers. For bulk primary learner registration, sign in, open Learners → Import Learners CSV, select the prepared CSV from your device, review, and confirm. Keep the CSV out of the public repository.
8. Configure the active subjects for each class. Junior classes are prepared with 9 default subjects.
9. Create/select an assessment and enter marks.
10. Open Rankings and confirm the subject-performance ranking appears at the top.
11. Print a class ranking in A4 landscape.
12. Generate and print an individual learner report in A4 portrait.
13. Record attendance and confirm it remains after refresh/login.
14. Test a backup before entering live records.
15. Never publish a Supabase service-role key or real learner data in a public repository.

## Timetable PDF download verification
- [ ] Select a class with a saved timetable and download its PDF.
- [ ] Select a teacher with lessons in the active term/year and download the individual timetable PDF.
- [ ] Download all school timetables and verify each scheduled class begins on a new A4 landscape page.
- [ ] Check that unscheduled classes are not added as blank pages and that the active term/year is shown correctly.

## Class ranking A4 verification
- [ ] Open Rankings, select the class and assessment, and confirm the class summary, grade distribution, ranked table, intervention priorities, and notice summary appear.
- [ ] Confirm EE1/EE2 are labelled “Exceeding Expectations 1/2.”
- [ ] Click **Download Class Ranking (A4 PDF)** and confirm the PDF is one A4 portrait page with no clipped content.
- [ ] Use print preview to verify a large class still fits; adjust scale only if necessary.

## Bulk report verification
- [ ] Select a class and assessment in Reports and use **Print All Reports for Class**.
- [ ] Download the combined class reports PDF and confirm each learner has a separate A4 page and pathway profile.

