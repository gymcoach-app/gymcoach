---
section: Security
---

The login and signup rate limits read the client IP from the right end of
`X-Forwarded-For` (the entry the nearest proxy added) instead of the leftmost
one, which a client behind an appending proxy could choose itself to get a
fresh bucket per request. `TRUSTED_PROXY_HOPS` (default 1) sets how many
proxies sit in front of the app. Upgrading with more than one proxy that
appends to the header (for example Cloudflare in front of nginx): set
`TRUSTED_PROXY_HOPS` to that number, or users who share an edge address share
one rate-limit budget. The app port must be reachable only through the proxy.
Found in the review of #505.
