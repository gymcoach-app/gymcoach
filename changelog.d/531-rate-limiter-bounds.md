---
section: Security
---

The rate limiter drops expired buckets once it holds many and never holds
more than 50,000, and `TRUSTED_PROXY_HOPS=0` serves an instance published
with no proxy: forwarded headers are ignored, so a client cannot pick its own
login or signup budget, at the cost of one shared budget. The default stays 1.
