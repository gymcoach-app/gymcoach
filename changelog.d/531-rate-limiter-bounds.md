---
section: Security
---

The rate limiter drops expired buckets once it holds many and never holds
more than 50,000, and `TRUSTED_PROXY_HOPS=0` serves an instance published
with no proxy: forwarded headers are ignored, so a client cannot pick its own
login or signup budget, but one client can then block every login and signup,
so it is a last resort behind the recommended reverse proxy. The default stays
1, and only an IP literal from those headers is used as a key.
