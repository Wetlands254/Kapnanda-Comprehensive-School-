# Ranking Print Fix – 13 Oct 2026

- Rebuilt the class-ranking print action as a standalone A4 portrait print document.
- Removed the conflicting ranking `zoom`/`transform` print paths from the active print workflow.
- Ranking print now uses a fixed 210 × 297 mm sheet and preserves colours.
- Ranking PDF export now captures one physical A4 page per class using jsPDF + html2canvas.
- Added **Download All Class Rankings** to create one multi-page A4 PDF containing every class with marks for the selected assessment.
- Ranking heading now uses **KAPNANDA COMPREHENSIVE SCHOOL** and **HARDWORK PAYS**.
