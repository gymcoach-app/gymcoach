---
section: Fixed
---

Exercise search ignores case and accents in every language, and matches the
dotted and dotless i in Turkish: "incline" finds "Incline ..." names and
"ip atlama" finds "İp atlama" on a Turkish phone. Fallback exercise initials
also follow the language's casing (follow-up to #537 by @sapatmohit).
