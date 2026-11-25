---
section: Security
---
The sign-in and sign-up forms are safe to use before the page has finished
loading (slow phone, slow network): a submit that fires before the page's
JavaScript runs no longer puts the email and the password in the URL, the
browser history and the server access log, and what was typed or autofilled
into the form is no longer erased when the page becomes interactive (#593).
