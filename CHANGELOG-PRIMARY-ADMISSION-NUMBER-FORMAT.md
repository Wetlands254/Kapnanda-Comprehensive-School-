# Primary Admission Number Format

- New primary and ECDE admission numbers use `KP` followed by exactly three digits: `KP001` through `KP999`.
- Manual learner creation and CSV imports validate the exact three-digit KP format.
- Automatic numbering continues from the highest existing KP number.
- The system will not generate a four- or six-digit KP number; it blocks new KP admissions when KP999 has been reached.
- Existing learner admission numbers are retained when editing existing records or matching existing learners during CSV import.
- Junior admission numbering remains on the existing KJ format.
