# Kapnanda AI Question Paper Generator

## What it adds
Teachers can generate:
- Topical Tests
- Mid Term Exams
- End Term Exams
- Revision Papers

The generator requires:
- Class
- Subject
- Term and year
- Topics/learning areas
- Number of A4 pages
- Questions per page
- Marks per question
- Teacher / prepared-by name
- Optional teacher instructions

Every generated question is labelled **APPLICATION** and the built-in engine uses real-life, school, home, community, farm, business, experiment, design and problem-solving situations.

## AI connection
The generator works without an external AI key using its built-in application-question engine.

For real AI generation, open **AI Question Papers → AI Connection** and configure an OpenAI-compatible chat-completions endpoint, API key and model.

For production, do not expose a permanent API key in browser code. The recommended deployment is to put the AI request behind a server/Supabase Edge Function and keep the secret on the server.

## Printing rules
Question papers are designed as exact A4 portrait pages. The teacher-selected page count becomes the number of A4 pages in the generated paper. The last page contains:
- Prepared by / teacher name
- Teacher signature line
- Date line

Each page includes:
- KAPNANDA COMPREHENSIVE SCHOOL
- Motto
- Assessment type
- Class
- Subject
- Term
- Academic year
- Duration
- Total marks
- Learner name
- Admission number
- Instructions
- Page number

## Shared database
Generated papers are stored in `questionPapers` in the shared school state, so authenticated teachers using the same Supabase database can access the generated-paper history.

## Security
API keys entered in the browser are stored only in that browser's local storage and are not added to the shared Supabase school database. A server-side AI proxy is recommended for production.
