# Contributing

Use Node 20.19+ and a clean install. `npm run test:python` uses
[uv](https://docs.astral.sh/uv/) to create a disposable Python 3.12 test
environment; install uv first.

```sh
npm ci
npm test
npm run test:python
npm run build
```

The neural engine is optional. Test it in a disposable venv instead of changing
an existing shared installation:

```sh
npx read-aloud-setup --venv "$PWD/.venv/read-aloud"
npm run test:python
```

Keep public examples synthetic. Do not commit rendered audio, model files,
cache directories, credentials, or personal text. By contributing original
code, you agree it may be distributed under this repository's MIT license.
