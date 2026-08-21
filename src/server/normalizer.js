import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_VENV } from './engines/kokoro.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', '..', 'python', 'normalize_cli.py')

/**
 * Markdown in, spoken prose out.
 *
 * Every engine goes through here, so "what does a heading sound like" is
 * answered once. The implementation is Python because that is where the
 * normalizer and its test suite already live, and a JavaScript twin of 370
 * lines of regex would be wrong within a month — but it is *standard-library*
 * Python, so it runs on the interpreter macOS and every Linux already ships and
 * needs no virtualenv.
 *
 * If there is no usable `python3` at all, this degrades to passing the text
 * through unchanged. Speech with the odd stray asterisk in it is a much better
 * failure than no speech.
 */

function resolvePython3(explicit) {
  const candidates = [
    explicit,
    process.env.READ_ALOUD_PYTHON3,
    process.env.READ_ALOUD_PYTHON,
    path.join(DEFAULT_VENV, 'bin', 'python'),
  ].filter(Boolean)
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found) return found
  // Nothing configured — is there a `python3` on PATH at all?
  const probe = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' })
  return probe.status === 0 ? 'python3' : null
}

export function createNormalizer({ pythonPath, idleTimeoutMs = 5 * 60_000, onLog = () => {} } = {}) {
  const python = resolvePython3(pythonPath)
  let child = null
  let idleTimer = null
  let nextId = 1
  const pending = new Map()

  function available() {
    return Boolean(python) && existsSync(SCRIPT)
  }

  function touchIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer)
    if (!idleTimeoutMs || idleTimeoutMs === Infinity) return
    idleTimer = setTimeout(() => pending.size === 0 && stop(), idleTimeoutMs)
    idleTimer.unref?.()
  }

  function start() {
    if (child) return child
    child = spawn(python, ['-u', SCRIPT], { cwd: path.dirname(SCRIPT) })

    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line) continue
        try {
          const message = JSON.parse(line)
          const waiting = pending.get(message.id)
          if (!waiting) continue
          pending.delete(message.id)
          waiting.resolve(message)
        } catch {
          onLog(`ignoring non-JSON line from normalizer: ${line.slice(0, 200)}`)
        }
      }
      touchIdleTimer()
    })

    child.stderr.on('data', (chunk) => onLog(`normalizer: ${chunk.toString().trimEnd()}`))

    const die = (reason) => {
      for (const waiting of pending.values()) waiting.resolve({ error: reason })
      pending.clear()
      child = null
    }
    child.on('error', (err) => die(err.message))
    child.on('close', () => die('the normalizer exited'))

    touchIdleTimer()
    return child
  }

  function stop() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    const running = child
    child = null
    if (running) {
      running.stdin.end()
      running.kill()
    }
  }

  /**
   * Resolves `{ text, leaks }`. Never rejects: a normalizer that is missing,
   * slow, or broken must not be able to take read-aloud down with it, so every
   * failure path returns the original text.
   */
  async function normalize(text, { readCode = false } = {}) {
    const original = String(text ?? '')
    if (!available() || !original.trim()) return { text: original, leaks: [] }

    const proc = start()
    if (!proc) return { text: original, leaks: [] }

    const id = String(nextId++)
    const response = await new Promise((resolve) => {
      pending.set(id, { resolve })
      proc.stdin.write(`${JSON.stringify({ id, text: original, read_code: readCode })}\n`, (err) => {
        if (!err) return
        pending.delete(id)
        resolve({ error: err.message })
      })
    })

    if (response.error || typeof response.text !== 'string') {
      if (response.error) onLog(`normalize failed (${response.error}) — speaking the raw text`)
      return { text: original, leaks: [] }
    }
    return { text: response.text || original, leaks: response.leaks ?? [] }
  }

  return { available, normalize, stop, pythonPath: python }
}
