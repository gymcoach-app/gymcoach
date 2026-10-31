---
section: Fixed
---

The gym equipment editor in Settings now reads a decimal comma too, with the
same rules as the plate list (follow-up to #522 by @sapatmohit): `2,5` is one
2.5 kg weight in comma-decimal languages, and its placeholders use the
language's decimal mark. In both editors a comma at either end of an entry
separates, so `25, 20, 2,5,` keeps the 2.5 kg plate. In comma-decimal languages
an unspaced pair such as `25,20` reads as 25.2; write `25, 20` for two plates.
