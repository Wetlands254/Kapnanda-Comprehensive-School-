# TPAD Assistant — curriculum-linked upgrade (GitHub Pages + Supabase)

This upgrade adds a **verified, cascading curriculum selector** to the existing TPAD Assistant. It does not replace your school's fee app, `app.js`, or any school-fee database table. It continues to use GitHub Pages (no Vercel) and Supabase for private drafts.

## What changed

- Choose the curriculum school level, then grade, subject/learning area, strand, sub-strand, topic and specific learning outcome from linked dropdowns.
- Suggested learning experiences, competencies, values and assessment guidance appear from the selected record when those fields are available.
- Each curriculum record must have an official source title, source URL and curriculum version, and must be marked verified before it is visible in the app.
- Teaching-related draft sections are blocked until a verified curriculum record is selected. The app does not invent a missing strand, sub-strand or learning outcome.
- The generated draft includes the selected curriculum reference and source. Teachers must still describe their actual work and real evidence.
- Private saved drafts remain protected by Supabase Row Level Security.

**Important:** The database curriculum catalogue may start empty, but a CSV import is no longer required. The form now includes **Use official KICD design directly (no CSV import)**. Open the official KICD design, copy the grade, subject, strand, sub-strand and learning outcome into those fields, and generate the draft. Direct-entry text is labelled teacher-entered and not database-verified; confirm it against the linked KICD design. The saved verified catalogue remains optional for faster repeated use.

## 1. Update your GitHub repository

1. Download and unzip this package.
2. Upload the `tpad/` folder to the root of your existing repository using **Add file → Upload files**.
3. Replace the existing `tpad/` files with these updated files. Keep your existing `app.js` and school-fee files unchanged.
4. Commit the changes.
5. If GitHub Pages is already enabled, the app remains at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/tpad/`. Otherwise open **Settings → Pages**, select **Deploy from a branch**, choose your main branch and `/(root)`, then save.

## 2. Update Supabase

1. Open your existing Supabase project → **SQL Editor → New query**.
2. Run the complete updated `tpad/schema.sql`. It preserves the existing `tpad_drafts` table and adds `curriculum_items`.
3. The browser app needs only your Supabase project URL and publishable/legacy anon key. Never put a service-role key in browser code.
4. Sign in to the TPAD Assistant with its separate Supabase Auth account.

## 3. Collect KICD designs online (new toolkit)

The package now includes a collector for the official KICD site. It discovers curriculum-design links, downloads direct PDFs hosted on KICD domains, and extracts searchable text into a review pack. Official source indexes: [Regular curriculum designs](https://kicd.ac.ke/cbc-materials/curriculum-designs/regular-curriculum-designs/) and [KICD curriculum materials](https://kicd.ac.ke/cbc-materials/).

### Easiest route: run from GitHub

1. Upload the new `tools/` folder and `.github/workflows/build-kicd-review-pack.yml` file to your repository root along with the updated `tpad/` folder.
2. Open your repository on GitHub and choose **Actions**.
3. Select **Build KICD curriculum review pack** and click **Run workflow**.
4. When it finishes, open that workflow run and download the `kicd-curriculum-review-pack` artifact.
5. Check `source-manifest.csv` for the source title, official URL, detected grade and download status. Open `extracted-text/` to search the downloaded designs.

You can also run the collector on a computer with Python and internet access:

```bash
python -m pip install -r tools/requirements.txt
python tools/sync_kicd_designs.py
```

It writes the review pack to `curriculum-review-pack/`. The collector follows only links on KICD domains; some pages may expose download landing pages rather than direct PDFs, and those will be noted in the manifest.

## 4. Verify and import curriculum rows

**The collector does not automatically certify or directly import curriculum rows.** PDF table extraction can rearrange columns, so it would be unsafe to label guessed rows as official. The review pack is an online collection/extraction step, not a completed verification of every subject.

1. Open `tpad/curriculum-template.csv`. It contains the exact columns required by Supabase.
2. For each selected grade and subject, compare the extracted text with the original official KICD PDF. Enter one row per specific learning outcome, copying strand, sub-strand, topic and outcome exactly. Include learning experiences, competencies, values and assessment guidance only when present in the source.
3. Fill `school_level` with exactly one of: `Primary School`, `Junior School`, `Senior School`, `Special Needs Education`. Confirm the grade-level mapping and subject against the original design.
4. Fill `source_title`, `source_url`, and `curriculum_version` for every row. Leave `is_verified` as `false` until a human checks the row. Then set it to `true` and fill `verified_by` and `verified_at`.
5. In Supabase **Table Editor → curriculum_items → Import data from CSV**, import the checked CSV. Ensure headings match the table fields exactly.
6. Refresh the app. Only verified rows will appear in the cascading dropdowns. This CSV import is optional; the direct-entry workflow can be used immediately.

The app intentionally blocks teaching-related drafts when no verified matching curriculum record exists. This prevents the assistant from inventing curriculum content. The current package does not claim the entire Primary, Junior and Senior School curriculum database is already populated; the collector must be run, and its output reviewed and imported before those dropdowns have full coverage.

## 5. Use the assistant

1. Select your teacher level, appraisal period and TPAD section.
2. Select curriculum level → grade → subject → strand → sub-strand → topic → learning outcome.
3. Describe what you actually taught/did, the strategies and resources actually used, the real evidence available, the outcome and next action.
4. Generate, review, edit and save/copy/download the draft.
5. Open the official [TSC TPAD portal](https://tpad2.tsc.go.ke/auth/login/?account=exists) separately and manually enter the reviewed text in the matching field. This app does not log in to or submit the official portal.

## Security and limitations

- This is an independent helper, not a TSC or KICD product.
- It does not automatically log in to TPAD, submit forms, verify attendance, or determine official appraisal ratings.
- Only signed-in users can read verified curriculum rows. Drafts are private per Supabase user through Row Level Security.
- Curriculum verification is a data-quality step: the database flag alone cannot prove the row was copied correctly. Review each row against the cited official design.
- Do not enter TSC passwords, ID numbers, or identifiable learner details. Never expose a Supabase service-role key.
- The SQL in this package does not alter your school-fee tables or existing `app.js`.
