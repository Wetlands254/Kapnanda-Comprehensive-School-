# Download and Print Fixes

- Timetable PDF exports now use the same shared `downloadPrintableDocument()` workflow used for printable fee/register documents, rather than a separate export path that could capture a blank page.
- Added PDF download and print buttons to the class list dialog and a shared HTML builder so both actions use identical content.
- Manual fee register uses the same shared PDF exporter and can produce a blank ruled register when the selected class has no enrolled learners.
- The shared PDF exporter now checks that the document contains content before attempting to render.
- Existing Reports and Rankings implementations were not changed.
