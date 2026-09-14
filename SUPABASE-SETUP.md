# Supabase Setup

This deployment is configured for the Kapnanda Supabase project `nrxstipepaevthkeuxoh`.

1. Open Supabase SQL Editor.
2. Paste and run `supabase-schema.sql`.
3. In Supabase → Authentication → Users, create the email/password account(s) for school staff/admins.
4. Confirm the user email if email confirmation is enabled.
5. Deploy the project to GitHub Pages.
6. Sign in to the website with the Supabase Auth email and password.

The browser uses the Supabase **publishable key**, not a service-role key. The key is intended for browser use when Row Level Security is correctly configured.

The application stores shared school data in the `school_state_shared` table using the record ID `KAPNANDA`.

## If login fails
- Check that the email exists under Authentication → Users.
- Use the password set for that Auth user.
- If the error says email not confirmed, confirm the user in Supabase.
- Use **Forgot Password?** on the website to send a Supabase reset email.
