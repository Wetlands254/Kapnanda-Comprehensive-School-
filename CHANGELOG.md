## Ranking A4 export refinement — 2026-10-12
- Added a dedicated Download Class Ranking (A4 PDF) action that exports a one-page A4 portrait PDF.
- Added full-sheet A4 print fitting and updated terminology to Exceeding Expectations.
- Preserved the eight-level grading scale, grade distribution, ranked learner table, intervention priorities, notice summary and charts.

# Kapnanda v3 — Final UI & Stability Fix

- Fixed the critical `Attendance is not defined` error that stopped sidebar pages from rendering.
- Added a complete daily Attendance register with Present / Late / Absent controls and save/print support.
- Added session restoration for Supabase Auth after page refresh when a valid session exists.
- Kept the correct Supabase project and publishable key configured.
- Added safer Performance page behavior when Chart.js is unavailable.
- Preserved the 9-subject class ranking and A4 landscape print design.
- Preserved A4 individual learner reports and PDF support.
- Reworked the interface with bright modern gradients, colourful KPI cards, cleaner tables, responsive layouts and refreshed login styling.
- Updated setup/deployment/security documentation to remove the obsolete local `admin / Admin123!` login instructions.
## 2026-10-12 — Primary learner CSV import
- Added an authenticated, user-confirmed CSV import workflow for bulk learner registration.
- Added duplicate/conflict checks and per-grade import preview before saving.
- Stored KNEC assessment numbers with learner records and displayed them in the learner register and printed class lists.
- New ECDE/primary admissions default to KP numbering; Grade 7–9 admissions default to KJ numbering.
- Kept the learner dataset outside application source files to avoid exposing real learner details in a public repository.

## School report and printing upgrade
- Redesigned learner reports with total marks, average, grade, class position, learning-area results, pathway performance profile (STEM, Arts & Sports, Social Sciences), and teacher comments.
- Added class-wide print and combined PDF download actions in Reports. Each active learner gets an individual A4 report page.
- Expanded class rankings with compact class-performance indicators and subject-average bar visualization; print layout is tuned for a single A4 sheet where class size permits.

## Class ranking visual redesign
- Reworked Class Ranking into a compact, reference-inspired exam analysis sheet with class KPIs, grade-distribution doughnut, grading scale, class performance summary, detailed learner ranking, intervention priorities, and notice-board summary.
- Standardized grade interpretation labels to **Exceeding Expectations 1/2**, Meeting Expectations 1/2, Approaching Expectations 1/2, and Below Expectations 1/2.
- Added a print/Save-as-PDF action and tuned the ranking sheet for A4 portrait printing. Browser print settings and unusually large classes may still affect pagination.

## Timetable PDF download update — 2026-10-12
- Added a **Download Class Timetable (PDF)** action for the currently selected class.
- Added an **Download Individual Teacher (PDF)** action for a selected teacher's weekly schedule.
- Added **Download All School Timetables (PDF)**, combining all classes with saved timetables for the active academic term/year, with each class beginning on a new page.
- PDF files use A4 landscape to preserve the timetable grid width; the app falls back to the browser print dialog if the PDF library is unavailable.
- Download actions check for an existing timetable and do not create or overwrite timetable records.


## Combined upgrade package — 2026-10-12
- Consolidated the class-ranking A4 redesign/download, learner report pathway and bulk class-report actions, and class/teacher/all-school timetable PDF downloads into one project package.
- Preserved the primary learner CSV import and KP/KJ admission-number rules already present in this build.
- Updated deployment instructions for testing ranking, reports, and timetable downloads together.


## AI Question Paper Generator
- Added AI-assisted application-focused question paper generator.
- Added exact A4 page selection, teacher name, signature and date area.
- Added topical, Mid Term, End Term and Revision paper types.
- Added built-in offline application-question engine plus optional OpenAI-compatible AI connection.
- Added shared `questionPapers` storage and print/PDF support.
 

## 2026-11-07 — Manual fee register, average grade and concurrent teacher saves

- Reworked the manual fee collection register into a learner-by-learner table with clear columns for admission number, learner name, class, fee due, three dated payment entries, total paid, balance and initials.
- Added the learner's average grade to the report form, calculated from the average mark using the school's configured grade bands.
- Added atomic compare-and-swap cloud saving with automatic merge-and-retry for concurrent teacher sessions. Separate learner and mark records are merged rather than blindly replacing the shared school data.
- Added cloud refresh handling that preserves local unsaved changes when another teacher's update arrives.
- Added a Supabase SQL function migration in `supabase-schema.sql`. Run the new `save_school_state_shared_cas` function section in the Supabase SQL Editor before using the updated app for shared multi-teacher saves.
- Updated asset version query strings to reduce stale browser-cache issues.


## 7 November 2026 — Fee and certificate improvements
- Added individual learner fee statement/invoice with payment history and printable/downloadable PDF.
- Added term/year-specific printable and downloadable fee structure.
- Added Kenyan primary school leaving certificate layout with learner admission and assessment numbers, dates, co-curricular strength checklist, generated positive HOI comment, and print/PDF actions.
- Increased concurrent compare-and-swap retries with staggered backoff for simultaneous teacher saves.
- Note: a single JSONB state row is still a serialization point; a normalized per-record schema is recommended for sustained 50+ concurrent users.


## A4 document and parent payment notification corrections
- Matched fee statement, fee structure and leaving certificate to the report-form A4 width and heading system.
- Increased and centred the Kenya crest across the fee and leaving documents.
- Corrected portrait PDF capture width and margins to reduce horizontal clipping on mobile PDF downloads.
- Added opt-in parent SMS consent controls and an optional automatic fee-payment confirmation SMS through the existing secure Supabase messaging function.
- Documented provider setup, consent requirements and the current PDF-attachment limitation.


## 2026-11-07 — Fee statement and fee structure print spacing
- Reduced excess internal padding and table-cell spacing on fee statements and fee structures.
- Removed duplicate outer PDF margin for those two PDF downloads and compacted print-window page margins.
- Preserved multi-page fee statement flow and wrapped table content.
- See `CHANGELOG-FEE-STATEMENT-STRUCTURE-COMPACT-PRINT-2026-11-07.md` for verification notes.
