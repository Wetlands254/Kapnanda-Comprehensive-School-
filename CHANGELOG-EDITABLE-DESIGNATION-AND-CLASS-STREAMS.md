# Editable Designation, Class Streams and Report Navigation

## Changes
- Added an editable learner stream field, separate from the grade/class. This keeps subject and assessment configuration attached to the grade while allowing stream names such as Blue, Pink, Purple, South, North, East or West.
- Added stream support to learner register display and optional learner CSV imports (`stream` or `class_stream` column).
- Added class → stream → learner filtering to Individual Learner Reports. The learner list preserves the current selection when possible, and bulk report print/PDF respects the selected stream.
- Report forms display the learner's class and stream and calculate class position within that stream.
- Added a configurable signatory designation in School Settings. The selected designation is used in report forms, fee structure approvals, leaving certificates, fee statements and BOM meeting packs.

## Setup
1. Open **Settings → School Settings**.
2. Enter the authorised signatory's full name.
3. Set **Head of Institution Designation** to Headteacher, Head of Institution, Principal, Chief Principal or any custom title.
4. Edit learners and enter their stream in **Stream (optional)**. Leave it blank for classes without streams.
5. In **Reports**, select a grade/class, then a stream, then a learner. Choose **All streams** to see the full grade.
