---
section: Security
---

Every response carries `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options` with a `frame-ancestors` policy, and a `Permissions-Policy`
that turns off camera, microphone and geolocation. HSTS stays with the HTTPS
proxy; the self-hosting guide shows how to add it.
