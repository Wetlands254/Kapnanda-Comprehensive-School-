# Tinet Primary & Junior School Management System — V3

A modern browser-based school management system for **Tinet ECDE, Primary and Junior School**.

## V3 focus

- Reliable class-specific marks entry with dynamic subject loading.
- Full CBC subject catalogues for each class, while preserving custom subject configurations.
- Explicit teacher → class → subject teaching assignments.
- Constraint-aware timetable generation for Upper Primary and Junior, including multiple teachers teaching different subjects in the same class.
- Teacher clash prevention when generating a whole section.
- Modern, colourful A4 printing for reports and class timetables.
- Correct school identity on generated timetables:
  - **TINET PRIMARY SCHOOL**
  - **TINET JUNIOR SCHOOL**
  - **TINET ECDE SCHOOL**
- Academic year and term aware subjects, fees and timetables.

## Timetable workflow

1. Add all teachers in **Teachers**.
2. Open **Teaching Assignments**.
3. Assign each teacher to the exact class and subject they teach and set weekly lessons.
4. Open **Timetables**.
5. Choose **Upper Primary** or **Junior**.
6. Use **Generate Whole Section** to schedule Grade 4–6 or Grade 7–9 together. This is the recommended mode because it can detect teacher clashes across classes.
7. Print the selected class timetable on A4.

If teaching assignments are missing, the system will still place lessons but will mark them **Unassigned** and show a warning. This is deliberate: it never invents a teacher allocation.

## Marks workflow

1. Open **Marks**.
2. Select the assessment.
3. Select the class.
4. The subject list refreshes automatically to show all active subjects for that class and assessment period.
5. Load learners, enter marks out of 50, and save.

## Security

For production use with real learner information, configure Supabase Auth and restrictive Row Level Security policies. Never place a Supabase service-role key in the browser.


### Timetable timing rules (V3.1)
- Lower Primary (Grades 1–3): 35-minute lessons, 8:00 AM start, lessons through 12:40 PM.
- Upper Primary (Grades 4–6): 35-minute lessons, 8:00 AM start, lessons through 3:10 PM.
- Junior (Grades 7–9): 35-minute lessons, 8:00 AM start, lessons through 3:10 PM.
- First break: 9:30–9:50 AM.
- Second break: 11:00–11:30 AM.
- Lunch: 12:40–1:40 PM.
- Personal Studies/Prep: 1:40–2:00 PM.
- Afternoon activities: from 3:30 PM for Upper Primary and Junior.
- Because 35-minute lessons starting at exactly 8:00 cannot land exactly on a 9:30 break, the 9:10–9:30 interval is reserved for a class routine/reading block so no lesson is shortened.
