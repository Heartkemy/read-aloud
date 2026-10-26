# Contributor notes

Use Node 20.19+ and a clean install. The normal verification path is:

```sh
npm ci
npm test
npm run test:python
npm run build
```

Keep examples and fixtures synthetic. Do not commit rendered audio, model files,
cache directories, credentials, or personal text. The server adapters are for
loopback, single-user use; do not broaden that contract without matching tests
and documentation. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
and [SUPPORT.md](SUPPORT.md) for the public workflow.
