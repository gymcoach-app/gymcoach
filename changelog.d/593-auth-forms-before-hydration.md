---
section: Security
---
A sign-in or sign-up form submitted before the page had finished loading
(slow phone, slow network) was sent as a page request with the email and the
password readable (URL-encoded) in the URL: `/login?email=...&password=...`.
It affects every earlier version, only the person who pressed the button that
early, and only their own credentials. The forms are now sent as a POST, the
server redirects a `/login` or `/signup` URL that carries a query string to
the bare page, no redirect carries a query string to or from these pages, a
redirected form POST is answered 303 so its body is not sent again, the two
pages are no longer kept in the offline cache, and entries an earlier version
cached for them are deleted the next time the app is opened. **Operators:**
such a URL may be in the access logs of your reverse proxy and of any CDN or
tunnel that terminates TLS in front of it (request line and referer), in the
history of the browser used (and the devices it syncs to) and, until the app
is next opened there, in its offline cache. Search your logs for `/login?`
and `/signup?` with `password=` and redact what you find. For an affected
account: change its password (an admin procedure, there is no self-service
change), set a new `JWT_SECRET` and restart to end the sessions already open
(a new password does not end them), review and revoke its MCP tokens, which
depend on neither, and change the password wherever else it was used. The
steps are in `docs/faq.md`, "Could a password have ended up in a URL or a
log?". What was typed or autofilled into these forms before the page became
interactive is also no longer erased (#593).
