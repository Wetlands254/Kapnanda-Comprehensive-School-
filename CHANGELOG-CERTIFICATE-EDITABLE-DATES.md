# Leaving Certificate – Editable Dates Update

## Changes
- The admission/entry date on the leaving-certificate form is now editable instead of read-only.
- The leaving date is explicitly labelled editable and remains selectable/editable.
- Existing learner admission dates are still prefilled as a convenience, but staff can correct or enter them before issuing.
- Certificate issue date remains automatically set by the system at the moment of issue.
- Issuance now requires both admission and leaving dates and rejects a leaving date earlier than the admission date.
- The certificate record stores the dates entered on the form.

## Manual verification still required
Test in the deployed school system on Android and desktop, issue a draft certificate with a manually entered admission date and leaving date, then verify both dates appear correctly in the PDF. The headteacher signature and official stamp remain the only handwritten items.
