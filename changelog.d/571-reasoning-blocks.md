---
section: Fixed
---
A reasoning model that opens its answer with a `<think>...</think>` block
(also `<thinking>`, `<reasoning>`) no longer breaks program generation, the
AI set parse or the coach's proposed adjustments, and the block is no longer
shown or stored in the weekly debrief and the coach chat, where it is held
back until it closes. Only leading blocks are removed; a block that never
closes counts as no answer (#571).
