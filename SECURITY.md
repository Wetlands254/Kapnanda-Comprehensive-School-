# Security

- Supabase Authentication controls sign-in.
- The browser contains only the Supabase publishable/anon key.
- Never put a Supabase service-role key in `index.html` or `app.js`.
- Row Level Security protects `school_state_shared` so unauthenticated visitors cannot read or modify the shared school data.
- Create only authorised staff accounts in Supabase Authentication.
- Do not publish real learner data in a public Git repository.
