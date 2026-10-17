# Fee Register and Capitation Upgrade

- Added a blank, printable manual fee register with due amount, three monthly payment columns, and total fees paid column for later CSV entry.
- Added Capitation & BOM Budget dashboard page with separate Primary and Junior receipts, expenditure ledger, proposed budget lines, CSV exports, and A4 portrait BOM meeting pack.
- Capitation transactions and budget lines are saved through the app's shared database state.
- Added print-ready styles for the fee register and BOM documents.
- Existing data and Supabase schema are preserved; the new finance records live in the existing `school_state_shared.data` JSON state.
