---
section: Security
---

Upgraded Next.js to 15.5.28, the MCP SDK to 1.32.2 and Prisma to 7.10.1, and
refreshed the vulnerable transitive packages (sharp, proxy-addr, body-parser,
qs, fast-uri and others) within their existing ranges. This closes the
published Next.js advisories up to 15.5.28, including remote code execution in
the image optimizer and several Server Action denial-of-service issues. The MCP
server also caps one tool call's arguments at 10,000 array elements and object
members before validating them, since the 8 MiB body cap alone does not bound
how much memory their validation can take.
