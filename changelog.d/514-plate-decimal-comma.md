---
section: Fixed
---

The plate list in Settings reads a decimal comma in comma-decimal languages
(French, German, Spanish, Portuguese, Italian, Russian), so `2,5` is one
2.5 kg plate instead of plates 2 and 5, thanks @sapatmohit (#514). Plates are
separated by a comma and a space, a semicolon or a space, an unspaced list such
as `25,20,15` still reads as separate plates, and the list is shown back with
the language's decimal mark. English input parses as before.
