# Report Forms Fix

Fixed the class report PDF export so it no longer produces a blank/empty PDF.

- Bulk report export stage is rendered visibly at A4 pixel width before html2pdf captures it.
- Removed negative z-index/off-screen positioning that could cause html2canvas to capture an empty page.
- Removed fixed 1123px height/hidden overflow from the bulk PDF stage so all learner report pages are captured.
- Each learner remains one A4 portrait page using the existing page-break rules.
- Print All Reports continues to use the browser print path separately.
