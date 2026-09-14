# Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor.
3. Paste and run `supabase-schema.sql`.
4. In the deployed system, choose **Configure Supabase**.
5. Enter the Supabase Project URL and publishable/anon key.
6. Create authenticated user accounts for school staff in Supabase Auth.
7. Test cloud login and shared data.

The frontend uses the dedicated shared-state key `KAPNANDA`, so it does not use the old the previous system shared-state identifier.
