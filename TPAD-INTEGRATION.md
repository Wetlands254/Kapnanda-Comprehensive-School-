# TPAD Assistant integration for Kapnanda Comprehensive School

## What was added
- A **TPAD Assistant** link in the school management sidebar. It opens the assistant in a new tab and leaves the existing school management screens unchanged.
- The assistant web app under `tpad/`.
- The KICD curriculum review-pack workflow and tools under `tools/` and `.github/workflows/`.
- A default connection to the same Kapnanda Supabase project used by the main app. The browser uses only the existing publishable/anon key.

## Required Supabase setup (one time)
1. Open the existing Kapnanda Supabase project: `https://nrxstipepaevthkeuxoh.supabase.co`.
2. Open **SQL Editor** and run the complete `tpad/schema.sql` file from this repository. It creates only `tpad_drafts` and `curriculum_items` (with row-level security); it does not alter the school management tables.
3. The assistant uses the same Supabase Auth project, but its saved TPAD drafts are private to each signed-in user. Users may need to sign in again in the TPAD Assistant tab.
4. `curriculum_items` starts empty intentionally. Use `tpad/curriculum-template.csv` and the instructions in `TPAD-ASSISTANT-README.md` to import curriculum rows verified against official KICD designs. Teaching-related drafts remain blocked until an appropriate verified curriculum row is selected.

## Deploy
Upload the contents of this repository to the root of the existing GitHub repository, preserving the `tpad/`, `tools/`, and `.github/workflows/` paths, then commit. Keep existing school files, especially `app.js`, `style.css`, and `supabase-schema.sql`. Enable GitHub Pages from the `main` branch if it is not already enabled. The assistant will be available at `/tpad/`.

## Important limitations
- The assistant drafts TPAD text; it does not log into or submit to the official TSC TPAD portal.
- The saved curriculum catalogue may be empty. CSV import is optional: the TPAD Assistant now has a direct-entry workflow so a teacher can open the official KICD designs and copy the exact grade, subject, strand, sub-strand and learning outcome into the draft form. Direct-entry references are labelled teacher-entered and are not falsely marked database-verified.
- Do not add service-role keys, TSC passwords, or identifiable learner details.
