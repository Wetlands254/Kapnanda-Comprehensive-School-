# Leaving certificate clipping correction — 7 November 2026

- Increased the portrait PDF capture stage to the full A4 CSS-pixel width (794 px at 96 DPI), rather than capturing a 190 mm document in a 190 mm-wide viewport.
- Kept the certificate itself at 190 mm and centred it within the full A4 capture area.
- Applied `box-sizing: border-box` consistently to certificate descendants so inner padding cannot make the content wider than its page.
- Reset inherited transforms, floats, text indentation, and horizontal offsets in the PDF capture stage.
- Applied the same safe content-width rules to native print output.
- Preserved the certificate's existing colours, typography, details, signatory and stamp areas.

## Verification status
- Source-level JavaScript syntax and ZIP integrity checks are performed on this package.
- Actual browser rendering, physical printer output, and the final PDF from a live school account still require deployment/browser testing; they are not claimed as passed here.
