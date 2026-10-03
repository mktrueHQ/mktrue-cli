## 6 · Security posture and data classes

<!-- Owned by this repository. mktrue renders this heading and never touches what follows. -->

This product holds: __MKTRUE_DATA_CLASSES__. Sign-in: __MKTRUE_AUTH__.

Every route is private unless it was deliberately made public. Missing configuration makes the service refuse to boot; it never falls back to something permissive. Data above never reaches a log, an error message, a URL or an analytics call.

A slice touching any of these runs the security auditor: __MKTRUE_AUDIT_TRIGGERS__.
