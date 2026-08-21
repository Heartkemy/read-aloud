import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVoiceId, voicesForLanguages } from '../../voices.js'

/**
 * The model-resident synthesizer process.
 *
 * Kokoro takes ten to twenty seconds to load and about a tenth of a second to
 * speak a sentence once it has. A one-shot subprocess per request therefore
 * spends ~99% of its life loading a model it is about to throw away — fine for
 * "narrate this article", useless for a speaker button on a paragraph, which is
 * the entire point of this library. So the process is started once, kept warm,
 * and killed again after an idle period because it holds ~1.5 GB.
 *
 * Everything here is deliberately serial. MLX generation is GPU-bound: running
 * two passages at once makes both slower and neither arrives sooner, so
 * requests queue in the order they were asked for and the caller never has to
 * think about concurrency.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Where `read-aloud-setup` puts the virtualenv. Outside any one project on
 *  purpose: the venv is ~1 GB and three apps sharing one machine should share
 *  one copy of it, the same way they already share the model cache. */
export const DEFAULT_VENV = path.join(homedir(), '.cache', 'read-aloud', 'venv')

export const DEFAULT_SCRIPT = path.join(HERE, '..', '..', '..', 'python', 'synthesize.py')

/**
 * Finds the Python that has `mlx-audio` in it.
 *
 * Order: an explicit path, then `$READ_ALOUD_PYTHON`, then the shared venv.
 * Never falls back to the system interpreter — a `python3` without mlx-audio
 * fails deep inside an import with a stack trace nobody can act on, where a
 * missing venv can say "run read-aloud-setup" instead.
 */
export function resolvePython(explicit) {
  const candidates = [
    explicit,
    process.env.READ_ALOUD_PYTHON,
    path.join(DEFAULT_VENV, 'bin', 'python'),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function createSynthesizer({
  pythonPath,
  scriptPath = DEFAULT_SCRIPT,
  model,
  idleTimeoutMs = 10 * 60_000,
  onLog = () => {},
} = {}) {
  const python = resolvePython(pythonPath)

  let child = null
  let ready = null // Promise<{voices: string[]}> once spawned
  let idleTimer = null
  let nextId = 1
  const pending = new Map()

  function available() {
    return Boolean(python) && existsSync(scriptPath)
  }

  function unavailableReason() {
    if (!python) {
      return (
        'No read-aloud Python environment found. Run `npx read-aloud-setup` once on this ' +
        'machine, or point $READ_ALOUD_PYTHON at a Python that has mlx-audio installed.'
      )
    }
    if (!existsSync(scriptPath)) return `Synthesizer script missing at ${scriptPath}`
    return null
  }

  function touchIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer)
    if (!idleTimeoutMs || idleTimeoutMs === Infinity) return
    idleTimer = setTimeout(() => {
      if (pending.size === 0) {
        onLog(`idle for ${Math.round(idleTimeoutMs / 1000)}s — releasing the model`)
        stop()
      }
    }, idleTimeoutMs)
    // Never hold the process open just to keep a voice warm.
    idleTimer.unref?.()
  }

  function start() {
    if (ready) return ready
    const reason = unavailableReason()
    if (reason) return Promise.reject(new Error(reason))

    const args = ['-u', scriptPath, '--serve']
    if (model) args.push('--model', model)
    child = spawn(python, args, { cwd: path.dirname(scriptPath) })

    ready = new Promise((resolve, reject) => {
      let buffer = ''
      let settled = false

      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString()
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (!line) continue

          let message
          try {
            message = JSON.parse(line)
          } catch {
            onLog(`ignoring non-JSON line from synthesizer: ${line.slice(0, 200)}`)
            continue
          }

          if (message.event === 'ready') {
            settled = true
            resolve({ voices: message.voices ?? [] })
            continue
          }

          const waiting = pending.get(message.id)
          if (!waiting) {
            onLog(`response for unknown request ${message.id}`)
            continue
          }
          pending.delete(message.id)
          if (message.ok) waiting.resolve(message)
          else waiting.reject(new Error(message.error || 'Synthesis failed.'))
          touchIdleTimer()
        }
      })

      // The model's own loading chatter goes here. Kept for `onLog` rather than
      // discarded: when a machine is missing espeak-ng, this is where it says so.
      child.stderr.on('data', (chunk) => onLog(chunk.toString().trimEnd()))

      child.on('error', (err) => {
        const failure = new Error(`Could not start the local speech model: ${err.message}`)
        if (!settled) reject(failure)
        failAllPending(failure)
        child = null
        ready = null
      })

      child.on('close', (code) => {
        const failure = new Error(
          `The local speech model exited${code === null ? '' : ` (code ${code})`}.`,
        )
        if (!settled) reject(failure)
        failAllPending(failure)
        child = null
        ready = null
      })
    })

    touchIdleTimer()
    return ready
  }

  function failAllPending(error) {
    for (const waiting of pending.values()) waiting.reject(error)
    pending.clear()
  }

  /**
   * Renders one passage to `out`, starting or reusing the warm process.
   * Resolves `{ seconds, voice, leaks }`.
   */
  async function render({ text, out, voice, speed = 1 }) {
    await start()
    if (idleTimer) clearTimeout(idleTimer)

    const id = String(nextId++)
    // `normalize: false` always: markdown became spoken prose upstream, in the
    // one normalizer every engine shares. Two copies of that logic is exactly
    // the drift this library exists to remove.
    const request = { id, text, out, voice, speed, normalize: false }

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify(request)}\n`, (err) => {
        if (!err) return
        pending.delete(id)
        reject(new Error(`Could not reach the speech model: ${err.message}`))
      })
    })
  }

  /**
   * Restarts the idle countdown on a model that is already loaded.
   *
   * The countdown otherwise runs from the last *render*, which is the wrong
   * event: a long passage renders all its segments in the first few seconds and
   * is then listened to for ten minutes, so the model can unload while someone
   * is still listening to it — and the next button they press pays a cold load.
   * Playback is the thing that says "this person is still here", so the client
   * touches this when a passage ends. Never starts the model: a page nobody is
   * using should not keep 1.5GB resident by pinging.
   */
  function touch() {
    if (child) touchIdleTimer()
    return Boolean(child)
  }

  function stop() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    const running = child
    child = null
    ready = null
    if (running) {
      running.stdin.end()
      running.kill()
    }
    failAllPending(new Error('The speech model was shut down.'))
  }

  return {
    available,
    unavailableReason,
    pythonPath: python,
    scriptPath,
    /** Loads the model without rendering anything. Turns the first click from a
     *  cold load into a warm render. */
    warmUp: start,
    touch,
    render,
    stop,
    /** True once the model is loaded and a request would be answered immediately. */
    get warm() {
      return Boolean(child)
    },
  }
}

/**
 * The Kokoro engine, in the shape `service.js` consumes.
 *
 * `id`-prefixed voices ("kokoro:bm_fable") because a machine can offer two
 * engines at once and "Daniel" exists in both — the prefix is what keeps a
 * remembered preference pointing at the voice the listener actually chose.
 */
export function createKokoroEngine({ languages = ['en'], ...options } = {}) {
  const synth = createSynthesizer(options)
  return {
    id: 'kokoro',
    label: 'Kokoro (neural, local)',
    available: synth.available,
    unavailableReason: synth.unavailableReason,
    warmUp: synth.warmUp,
    touch: synth.touch,
    voices: () => voicesForLanguages(languages),
    render: ({ text, out, voice, speed }) =>
      synth.render({ text, out, voice: parseVoiceId(voice).nativeId, speed }),
    stop: synth.stop,
    get warm() {
      return synth.warm
    },
  }
}
