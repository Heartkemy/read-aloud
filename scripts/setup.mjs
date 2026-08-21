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

if (!has('espeak-ng')) {
  console.warn(
    '\n  ! espeak-ng is missing. It is the fallback for words the phonemizer does not know;\n' +
      '    without it, unusual names and abbreviations come out wrong.\n' +
      '      brew install espeak-ng\n',
  )
}

console.log(
  '\nread-aloud: ready. The model (~350 MB) downloads on first use.\n' +
    'Point an app at a different environment any time with $READ_ALOUD_PYTHON.\n',
)
