---
section: Added
---
The AI coach can run on a local model: `LLM_PROVIDER=openai-compatible`
talks to any OpenAI Chat Completions server (Ollama, LM Studio, vLLM,
llama.cpp server, or another gateway) at `OPENAI_COMPATIBLE_BASE_URL`, with
`OPENAI_COMPATIBLE_MODEL`, an optional `OPENAI_COMPATIBLE_API_KEY` and an
optional `OPENAI_COMPATIBLE_MAX_TOKENS` output budget. The base URL is checked
before any request (http or https, no credentials in it), a redirect is
refused, and the self-hosting guide has an Ollama example with the context
length to raise (closes #528).
