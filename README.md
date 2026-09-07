# Kapnanda Comprehensive School Management System

This is a new, clean version based on the uploaded Kapnanda system's purpose and structure.

## Included modules
- Dashboard
- Students
- Teachers
- Classes
- Attendance
- Fees & Payments
- Exams & Results
- Staff & Users
- Announcements
- Settings
- Automatic saving
- JSON export
- Responsive mobile layout

## Important: no password
This version intentionally has **no login/password screen**.

That means any person who can open the application can edit and delete records. This is appropriate only where the application is protected by the school's device/network/access controls.

## Saving
The starter version saves data automatically in the browser's localStorage. Therefore:
- saving works immediately;
- data persists on the same browser/device;
- different computers do NOT automatically share the same database.

## Supabase shared database
Because you already created Supabase, the next production step is to connect these modules to Supabase tables and configure Row Level Security for the school's staff access model.

For a truly shared no-password system, do not expose a Supabase service-role key in the browser. Use a safe server-side/API layer or carefully designed anonymous/RLS policies.
