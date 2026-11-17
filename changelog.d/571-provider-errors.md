---
section: Fixed
---
A failed AI provider call now says what went wrong and what to do: rejected
API key (with the variable to check), rate limit or credits, model or request
refused, provider outage, timeout, answer cut off, or missing setting. The
coach debrief, the chat, program generation and "Parse with AI" return a
stable `code` (`ai_invalid_key`, `ai_quota`, ...) with a `502`/`503`/`504`
status instead of the provider's own status and text, the UI shows the message
in all 11 languages, and the server log keeps only the class and the upstream
status (#571).
