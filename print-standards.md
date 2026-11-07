# Kapnanda School Management System — Print, PDF & Download Standards

## 1. Page Layout and Orientation

1. **A4 portrait** is the default for rankings, class lists, learner reports, attendance registers, fee lists, receipts, fee statements, and academic summaries.
2. **A4 landscape** is reserved for timetables and other documents that genuinely require a wider layout.
3. Documents must be properly centred, use consistent A4 margins, and fit the printable page without unnecessary shrinking.
4. Grade/Class Ranking must occupy the page appropriately and must not shrink into a small block at the top of the paper.

## 2. Printing and Colour Preservation

5. Print controls, navigation menus, search boxes, action buttons, and other non-document interface elements must be hidden automatically.
6. School colours, logos, banners, table headings, borders, and grade colours must be preserved in print and PDF output.
7. Print styles must enable accurate colour reproduction, with background graphics and background colours supported where the browser permits them.
8. All academic and administrative documents must maintain consistent fonts, spacing, alignment, and readable text sizes.

## 3. Prevent Blank or Empty Downloads

9. **Every download and export button must produce a valid, non-empty document containing the expected data.** This applies to learner reports, class rankings, fee registers, fee lists, receipts, fee statements, timetables, attendance registers, class lists, mark sheets, academic summaries, and all other downloadable records.
10. Before generating a document, the system must confirm that the selected class, term, academic year, learner, or other required data has loaded successfully.
11. PDF generation must wait until the document content, fonts, images, logos, and tables have finished rendering.
12. PDF export must use content inside the printable document area. Content must not be positioned far off-screen where browser PDF libraries may fail to render it.
13. The system must handle slow loading, missing data, empty selections, and rendering errors gracefully. It must display a clear message instead of silently downloading a blank document.
14. Download filenames must identify the document type, class or grade, term, and academic year where applicable.
15. All downloads must be tested using realistic records before an upgrade is considered complete.

## 4. Rankings and Learner Reports

16. Browser printing and PDF export for class rankings must use the same A4 layout, preserving colours, headings, marks, averages, positions, and school identification.
17. Bulk learner report downloads must generate one complete learner report per A4 page, with deliberate page breaks between learners.
18. Individual learner reports must contain the correct learner details, entry number, class, subjects, marks, grades, teacher comments, and other applicable fields.
19. Class ranking downloads must support both individual class rankings and a bulk download of all available class rankings.
20. Academic tables must repeat their column headings on subsequent pages where necessary, and rows must not split unpredictably across pages.

## 5. Fees and Financial Documents

21. Fee lists and fee registers must display the correct learners, classes, fee charges, payments, balances, and applicable term or academic year.
22. Receipts and fee statements must include the correct learner identification, transaction details, amounts, dates, and receipt numbers where applicable.
23. Fee documents must not be blank because of missing class selections, delayed database queries, hidden elements, or incorrect print styles.
24. Cancelled records and excluded learners must be handled according to the system's established financial and administrative rules.

## 6. Timetable Downloads

25. Timetables must use A4 landscape where appropriate, with readable subject names, teacher codes, class labels, lesson times, breaks, and school branding.
26. Timetable downloads must reflect the latest saved timetable, not an outdated or unsaved version.
27. Both individual class timetables and bulk timetable exports must be supported where applicable.
28. Timetable colours and cell boundaries must remain visible in printed and downloaded versions.

## 7. General Download Reliability

29. Every download control must be connected to a working export function; no decorative or non-functional download buttons are permitted.
30. Export functions must retrieve the correct database records and must not depend on temporary browser-only data when the authoritative records are stored in Supabase.
31. Downloads must work on supported desktop and mobile browsers, with clear error messages if a particular format is unsupported.
32. Where a document genuinely requires multiple pages, page breaks must be controlled deliberately to prevent random splits, clipped tables, and missing content.
33. PDF generation must be tested for blank pages, missing text, missing colours, clipped content, incorrect page orientation, and incomplete data.
34. **Final acceptance requirement:** every printable or downloadable module must be tested from the user interface through to the resulting file. A successful button click alone does not count as a successful download.

## 8. Browser Print Recommendation

For the cleanest colour output, users should enable **Background graphics / Background colours** in the browser's print dialog whenever that option is available.

## Priority

Reliability and correct data come first, followed by layout, colour preservation, and visual consistency. No module should be considered complete until its downloaded and printed documents have been verified.
