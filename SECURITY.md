# Security policy

`read-aloud` supports a local, single-user service only. The Node adapter
requires loopback host and peer, and both adapters reject unapproved browser
origins and send audio with `Cache-Control: private, no-store`. The Fetch API
cannot expose a socket peer, so its adapter validates the loopback request URL
and origin only; use it solely in a handler that preserves that local boundary.
A remotely deployed host needs its own authentication and user isolation; this
project does not provide them.

Report vulnerabilities privately through GitHub's private vulnerability-report
form for [Heartkemy/read-aloud](https://github.com/Heartkemy/read-aloud/security/advisories/new).
Do not include exploit details, private audio, or credentials in a public issue.
