---
section: Security
---
A sign-in or sign-up form submitted before the page had finished loading
(slow phone, slow network) was sent as a page request with the email and the
password in the URL: `/login?email=...&password=...`. It affects every
earlier version, only the person who pressed the button that early, and only
their own credentials. The forms are now sent as a POST, the server redirects
a `/login` or `/signup` URL that carries a query string to the bare page, no
redirect carries a query string to or from these pages, the two pages are no
longer kept in the offline cache, and entries an earlier version cached for
them are deleted the next time the app is opened. **Operators:** such a URL
may be in your reverse proxy's access logs (request line and referer), in the
history of the browser used and, until the app is next opened there, in its
offline cache. Search your logs for `/login?` and `/signup?` with
`password=`, redact what you find and have the people concerned change their
password; the steps are in `docs/faq.md`, "Could a password have ended up in
a URL or a log?". What was typed or autofilled into these forms before the
page became interactive is also no longer erased (#593).
