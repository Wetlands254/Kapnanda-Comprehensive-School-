# Fee Statement and Fee Structure — Compact A4 Print Fix

## Implemented
- Reduced the document's internal padding to a compact 4–5 mm instead of the former 10 mm.
- Reduced table-cell padding and section spacing to reclaim usable page area.
- Removed the additional 5 mm html2pdf outer margin for fee statements and fee structures, avoiding stacked outer and inner padding.
- Set the print-window A4 page margin to 5 mm and reduced the document's inner padding.
- Kept tables at full available width with fixed layout and wrapping to prevent left/right clipping.
- Preserved long fee statement table flow across pages; rows are kept together where possible.
- Kept school branding, colours, fee history, totals and signatures in the document.

## Verification
- `node --check app.js`: passed.
- Static checks confirmed both fee document templates and compact export/print rules remain present.
- ZIP integrity checked after packaging.
- Actual browser PDF rendering and physical Android/desktop print tests were not available in this run; verify those after deployment.
