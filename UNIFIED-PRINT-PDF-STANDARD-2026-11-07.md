# Unified Print and PDF Standard — 7 November 2026

## Reference
The approved individual learner report form is the layout reference. Its A4 portrait export uses a 794 × 1123 CSS-pixel page canvas with a centred 741-pixel content area (approximately 7 mm safe margins). Landscape uses 1122 × 794 pixels with a centred 1069-pixel content area.

## Implementation
- `downloadPrintableDocument()` is the shared PDF export path for documents that call it.
- Exports render in a visible, in-page staging element; no off-screen capture or fixed-height clipping.
- Portrait is the default for ordinary school documents; landscape remains for genuinely wide tables and timetables.
- Tables, logos, and text are constrained to the page width; table headers repeat and rows avoid splitting where supported.
- Multi-page content is retained and paginated instead of being clipped to a single A4-height canvas.
- The dedicated learner report and ranking exporters are left intact because they have their own verified pagination and layout behavior.
- No database schema, Supabase data, fee calculations, marks, rankings, or school records are changed.

## Files changed
- `app.js`: shared export function.
- `style.css`: shared export presentation rules.
- `index.html`: stylesheet cache version.

## Validation
JavaScript syntax, ZIP integrity, and changed-file review are checked when this package is built. Actual PDF appearance still requires testing in the deployed Android browser and desktop browser for a short single-page document, a long multi-page register, a fee statement, fee structure, and leaving certificate.
