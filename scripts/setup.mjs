#!/usr/bin/env node
/**
 * One-time setup for the neural engine.
 *
 *   npx read-aloud-setup
 *
 * Creates the shared virtualenv at ~/.cache/read-aloud/venv and installs
 * mlx-audio + misaki[en] into it. Shared rather than per-project on purpose:
 * it is about a gigabyte, and three apps on one machine should not each have
 * their own copy of the same interpreter and the same model loader.
 *
 * Everything this touches lives outside the repo, and nothing here is required
 * for the macOS system voices — those work with no setup at all.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const VENV = path.join(homedir(), '.cache', 'read-aloud', 'venv')
const PY = path.join(VENV, 'bin', 'python')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  return result.status === 0
}

function has(command) {
  return spawnSync('command', ['-v', command], { shell: true, stdio: 'ignore' }).status === 0
}

console.log(`read-aloud: setting up the neural engine in ${VENV}`)

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.warn(
    '\n  ! The neural engine uses MLX, which is Apple Silicon only.\n' +
      '    On this machine it will not run. The macOS system voices (if you are on a Mac)\n' +
      '    need no setup at all, so read-aloud may already be working.\n',
  )
}

if (!existsSync(PY)) {
  const uv = has('uv')
  const created = uv
    ? run('uv', ['venv', '--python', '3.12', VENV])
    : run('python3', ['-m', 'venv', VENV])
  if (!created) {
    console.error('read-aloud: could not create the virtualenv.')
    process.exit(1)
  }
}

const uv = has('uv')
const installed = uv
  ? run('uv', ['pip', 'install', 'mlx-audio', 'misaki[en]'], { env: { ...process.env, VIRTUAL_ENV: VENV } })
  : run(PY, ['-m', 'pip', 'install', '--upgrade', 'mlx-audio', 'misaki[en]'])

if (!installed) {
  console.error('read-aloud: dependency install failed.')
  process.exit(1)
}

// `misaki[en]` depends on espeakng-loader, which ships libespeak-ng inside the
// wheel and hands misaki the path to it — so the *binary* on PATH is irrelevant
// and `brew install espeak-ng` is not needed. Checking `command -v espeak-ng`
// told a working machine it was broken, which is worse than saying nothing; the
// python package is the thing that actually has to be there.
if (!run(PY, ['-c', 'import espeakng_loader; espeakng_loader.get_data_path()'], { stdio: 'ignore' })) {
  console.warn(
    '\n  ! espeakng-loader is missing or has no data directory. It is the phonemizer\n' +
      '    fallback for words the model does not know, and misaki needs it.\n' +
      `      ${PY} -m pip install espeakng-loader\n`,
  )
}

// misaki's English G2P calls `spacy.load('en_core_web_sm')` the first time it
// phonemizes anything, and spacy's own fallback for a missing model is to shell
// out and install it. That shell-out finds `uv` on PATH, and `uv pip install`
// with no VIRTUAL_ENV set refuses outright — so the first synthesis dies with
// "No virtual environment found", from a process the caller never asked to have
// installing packages. Setup is the place to pay for this, not the first click.
// spacy's own downloader, not a pinned wheel URL: it picks the model version
// that matches the installed spacy. VIRTUAL_ENV is set because it delegates to
// uv when uv is on PATH, and uv with no VIRTUAL_ENV resolves a `.venv` from the
// *current directory* — which quietly installs the model into whatever project
// the setup happened to be run from. The model is not on PyPI, so this is the
// only supported way in.
const spacyModel = run(PY, ['-m', 'spacy', 'download', 'en_core_web_sm'], {
  env: { ...process.env, VIRTUAL_ENV: VENV },
})

if (!spacyModel) {
  // Not fatal: the runtime install may still work if the caller happens to
  // have a usable environment. Say so rather than failing the whole setup.
  console.warn(
    '\n  ! Could not pre-install spacy\'s en_core_web_sm model.\n' +
      '    The first synthesis will try to fetch it, and will fail if the process\n' +
      '    running it has no VIRTUAL_ENV set. Install it by hand with:\n' +
      `      ${PY} -m spacy download en_core_web_sm\n`,
  )
}

console.log(
  '\nread-aloud: ready. The model (~350 MB) downloads on first use.\n' +
    'Point an app at a different environment any time with $READ_ALOUD_PYTHON.\n',
)
