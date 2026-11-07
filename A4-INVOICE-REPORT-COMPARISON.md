# A4 Report and Invoice Layout Review

## Reference layout
The individual learner report (`.printreport` / `.class-bulk-report`) is the better visual reference: centred school identity, compact learner details, structured tables, colour accents and signature area. It already has a dedicated A4 portrait print path.

## Issues found in the invoice
- The invoice print-window CSS forced the header to `flex-wrap:nowrap`, risking the school name being clipped.
- The generic A4 table layout used automatic column sizing, allowing long payment dates to distort columns.
- Payment history printed raw ISO timestamps, making the date long and hard to read.
- The invoice did not use consistent labelled metadata blocks like the report form.

## Changes made
- Rebuilt invoice markup with report-like heading, metadata blocks, section headings, table styling and signatures.
- Added fixed table column proportions and safe text wrapping.
- Formatted payment dates as readable `DD Mon YYYY` values.
- Updated the separate print-window CSS to allow header wrapping and fixed-layout tables.
- Kept the invoice as A4 portrait and left timetable landscape rules untouched.

## Validation
Run `node --check app.js` before deployment. Test one invoice with multiple payments and a learner report with a full subject list in browser Print Preview, A4 portrait, scale 100%, headers/footers off. Check that neither the left edge nor payment-history columns are clipped.
