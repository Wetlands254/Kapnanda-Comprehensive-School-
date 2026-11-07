# A4 Portrait Download Correction — 7 November 2026

## Fixed
- Fee statements, fee structures and leaving certificates now render inside a fixed 200 mm portrait export canvas, matching the report-form approach.
- The PDF export canvas no longer expands to a descendant's `scrollWidth`; this was allowing wider content to alter the capture scale and produce inconsistent portrait output.
- A consistent 5 mm PDF margin is applied to these documents.
- Leaving certificates retain their 190 mm centred certificate layout inside the fixed canvas.
- Fee statement content remains allowed to flow onto additional A4 pages; table rows are still protected from splitting where possible.
- Other document export paths, including report forms, class rankings and landscape timetables, are not changed by this targeted export correction.

## Validation
- `node --check app.js` passes.
- ZIP integrity verified after packaging.
- Browser/Android PDF rendering still needs to be confirmed in the deployed site because a live browser session is not available in this build step.
