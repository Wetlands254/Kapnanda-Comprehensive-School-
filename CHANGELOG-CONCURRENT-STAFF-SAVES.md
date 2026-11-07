# Concurrent staff saves — 7 November 2026

- Added record-delta cloud saves through a new atomic Supabase RPC.
- Removed the browser-side save queue from normal cloud saves.
- Added server-side admission-number duplicate validation for simultaneous learner registration.
- Marks are merged by learner, assessment and subject.
- Marks screen now waits for the cloud save confirmation before displaying success.
- Added deployment and multi-device test instructions.

Not yet verified: live migration, simultaneous multi-device saves against the school's Supabase project, and production behavior during network interruption.
