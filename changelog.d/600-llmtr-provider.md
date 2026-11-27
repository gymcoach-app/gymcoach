---
section: Added
---
LLMTR can be picked as the LLM provider with `LLM_PROVIDER=llmtr` and
`LLMTR_API_KEY`, with an optional `LLMTR_MODEL` and an optional
`LLMTR_MAX_TOKENS` floor on the output budget. It is a prepaid
OpenAI-compatible gateway reached through the existing Chat Completions
client, and the self-host Compose files and docs list the new variables
(#600).
