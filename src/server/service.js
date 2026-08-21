import { createHash } from 'node:crypto'
import fs, { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { segmentText } from '../segment.js'
import { DEFAULT_VOICE, parseVoiceId } from '../voices.js'
import { createKokoroEngine } from './engines/kokoro.js'
import { createSayEngine } from './engines/say.js'
import { createNormalizer } from './normalizer.js'

/**
 * The server half: a cache with engines behind it.
 *
 * Audio is content-addressed — the same passage, in the same voice, normalized
 * the same way, is rendered once and served as a file forever after. That is
 * what makes a speaker button on every paragraph affordable: the second listen,
 * the reload and the other tab all cost a static file read.
 *
 * Clips are served from here rather than dropped into the host app's `public/`
 * directory, so nothing depends on how the framework serves static files and a
 * dev server doesn't reload the page every time a paragraph is spoken. The
 * price is the ~40 lines of HTTP Range handling below, which is also what lets
 * the scrubber seek without downloading the whole clip first.
 */

/** Bumped only for changes in how a clip is *rendered* that the cache key can't
 *  see by itself. Normalizer changes need no bump: the key is computed from the
 *  normalized text, so better normalization is automatically a new key. */
export const CACHE_VERSION = 2

function defaultCacheDir() {
  if (fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
    return path.join(process.cwd(), 'node_modules', '.cache', 'read-aloud')
  }
  return path.join(tmpdir(), 'read-aloud')
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > limitBytes) {
        req.destroy()
        reject(new Error('Request body too large.'))
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/**
 * Duration of a PCM WAV, by walking its chunks.
 *
 * Not by reading offsets 28 and 40 of a "canonical 44-byte header": that works
 * for one encoder and silently returns nonsense for another. macOS `say` writes
 * a `LIST` chunk before `data`, which is exactly the case the shortcut gets
 * wrong — and a wrong duration is a scrubber that can't reach the end.
 */
export function wavSeconds(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(12)
    fs.readSync(fd, head, 0, 12, 0)
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return 0

    const size = fs.fstatSync(fd).size
    let offset = 12
    let byteRate = 0
    const header = Buffer.alloc(8)
    while (offset + 8 <= size) {
      fs.readSync(fd, header, 0, 8, offset)
      const id = header.toString('ascii', 0, 4)
      const length = header.readUInt32LE(4)
      if (id === 'fmt ') {
        const fmt = Buffer.alloc(Math.min(length, 16))
        fs.readSync(fd, fmt, 0, fmt.length, offset + 8)
        byteRate = fmt.readUInt32LE(8)
      } else if (id === 'data') {
        return byteRate > 0 ? Number((length / byteRate).toFixed(2)) : 0
      }
      // Chunks are word-aligned: an odd length is followed by a pad byte.
      offset += 8 + length + (length % 2)
    }
    return 0
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * @param {object} options
 * @param {string} [options.basePath] URL the API is mounted at. Must match what
 *   the client is given — the clip URLs handed back are built from it.
 * @param {string} [options.cacheDir] Where rendered clips live.
 * @param {string} [options.defaultVoice] Engine-qualified id, e.g. `say:Karen`.
 * @param {string[]|null} [options.languages] Catalogue languages to offer.
 * @param {number} [options.maxCachedClips] Disk cap; oldest evicted first.
 * @param {Array} [options.engines] Override the engine list entirely.
 */
export function createReadAloudService({
  basePath = '/api/read-aloud',
  cacheDir = defaultCacheDir(),
  defaultVoice = DEFAULT_VOICE,
  languages = ['en'],
  maxCachedClips = 200,
  maxTextLength = 20_000,
  idleTimeoutMs,
  pythonPath,
  scriptPath,
  model,
  engines,
  onLog = () => {},
} = {}) {
  const allEngines =
    engines ??
    [
      createKokoroEngine({ languages, pythonPath, scriptPath, model, idleTimeoutMs, onLog }),
      createSayEngine({ languages }),
    ]
  const normalizer = createNormalizer({ onLog })

  // One render per cache key at a time. Two components asking for the same
  // passage at once — a warm-up racing a click — must not become two renders
  // writing the same file, which is both wasteful and a torn-file hazard.
  const inFlight = new Map()
  let voiceIndex = null

  fs.mkdirSync(cacheDir, { recursive: true })

  function activeEngines() {
    return allEngines.filter((engine) => engine.available())
  }

  /** Every voice on this machine, across every working engine, keyed by id. */
  async function voiceCatalogue() {
    if (voiceIndex) return voiceIndex
    const lists = await Promise.all(activeEngines().map((engine) => engine.voices()))
    voiceIndex = new Map(lists.flat().map((voice) => [voice.id, voice]))
    return voiceIndex
  }

  async function resolveVoice(requested) {
    const catalogue = await voiceCatalogue()
    if (requested && catalogue.has(requested)) return catalogue.get(requested)
    if (catalogue.has(defaultVoice)) return catalogue.get(defaultVoice)
    // The configured default belongs to an engine this machine hasn't got —
    // a Kokoro default on a machine with no Python, usually. Falling back to
    // *something that speaks* beats refusing to speak at all.
    const first = catalogue.values().next()
    return first.done ? null : first.value
  }

  function engineFor(voice) {
    const { engine } = parseVoiceId(voice.id)
    return allEngines.find((candidate) => candidate.id === engine) ?? null
  }

  function evictOldClips() {
    const clips = fs
      .readdirSync(cacheDir)
      .filter((name) => name.endsWith('.wav'))
      .map((name) => {
        const full = path.join(cacheDir, name)
        return { full, mtime: fs.statSync(full).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    for (const stale of clips.slice(maxCachedClips)) {
      try {
        fs.unlinkSync(stale.full)
      } catch {
        // A clip that vanished underneath us is exactly the state we wanted.
      }
    }
  }

  /** Renders one already-normalized chunk of speech. Everything below goes
   *  through here, so the cache key is computed in exactly one place. */
  async function renderChunk({ spoken, voice, engine }) {
    const key = createHash('sha256')
      .update(`v${CACHE_VERSION}\n${voice.id}\n${spoken}`)
      .digest('hex')
      .slice(0, 20)
    const file = path.join(cacheDir, `${key}.wav`)
    const url = `${basePath}/clip/${key}.wav`

    if (fs.existsSync(file)) {
      // Touch it, so "recently listened to" counts as recent when evicting.
      const now = new Date()
      fs.utimesSync(file, now, now)
      return { key, url, seconds: wavSeconds(file), voice: voice.id, cached: true }
    }

    const existing = inFlight.get(key)
    if (existing) return existing

    const job = engine
      .render({ text: spoken, out: file, voice: voice.id })
      .then((result) => {
        if (!fs.existsSync(file)) throw new Error('Synthesis produced no audio.')
        evictOldClips()
        return {
          key,
          url,
          seconds: result?.seconds ?? wavSeconds(file),
          voice: voice.id,
          cached: false,
        }
      })
      .finally(() => inFlight.delete(key))

    inFlight.set(key, job)
    return job
  }

  /** Prepares a request: resolves the voice and engine, normalizes the text. */
  async function prepare({ text, intro, voice: requestedVoice }) {
    const body = String(text ?? '').trim()
    if (!body) throw new Error('Nothing to speak.')
    if (body.length > maxTextLength) {
      throw new Error(
        `Passage is too long to speak (${body.length} of ${maxTextLength} characters).`,
      )
    }

    const voice = await resolveVoice(requestedVoice)
    if (!voice) throw new Error('No speech engine is available on this machine.')
    const engine = engineFor(voice)
    if (!engine) throw new Error(`No engine can speak "${voice.id}".`)

    const source = intro ? `${String(intro).trim()}\n\n${body}` : body
    const { text: spoken, leaks } = await normalizer.normalize(source)
    if (leaks?.length) {
      // Non-empty means normalize.py has a gap and something was voiced as
      // "asterisk". Audible, so it does not pass silently.
      onLog(`markdown leaked into speech: ${leaks.join(' ')}`)
    }
    return { spoken, voice, engine }
  }

  /**
   * Splits a passage into segments and renders **only the first** before
   * answering; the rest are rendered in the background, in order, while the
   * listener is hearing segment one.
   *
   * This is what makes a long passage start in under a second instead of after
   * a twenty-second render. Every segment's URL is a content hash and is known
   * before its audio exists, so the client can simply request the next one — and
   * `serveClip` waits for an in-flight render rather than answering 404.
   *
   * Resolves `{ segments: [{ url, seconds }], voice, segmented: true }`, where
   * `seconds` is real for the first segment and `null` for the others until
   * they have been rendered.
   */
  async function synthesizeSegments(input) {
    const { spoken, voice, engine } = await prepare(input)
    const parts = segmentText(spoken, input.segmentation)
    if (parts.length <= 1) {
      const clip = await renderChunk({ spoken, voice, engine })
      return {
        segments: [{ url: clip.url, seconds: clip.seconds, chars: spoken.length }],
        voice: voice.id,
        segmented: false,
      }
    }

    const first = await renderChunk({ spoken: parts[0], voice, engine })

    // The rest, in order, on the same serial engine queue. Deliberately not
    // awaited — and deliberately not parallel: generation is GPU-bound, so
    // asking for all of them at once makes the *second* one arrive later, which
    // is the only one whose arrival time the listener can feel.
    const rest = parts.slice(1)
    void rest
      .reduce(
        (chain, part) => chain.then(() => renderChunk({ spoken: part, voice, engine }).catch(() => {})),
        Promise.resolve(),
      )
      .catch(() => {})

    const keyFor = (part) =>
      createHash('sha256').update(`v${CACHE_VERSION}\n${voice.id}\n${part}`).digest('hex').slice(0, 20)

    return {
      voice: voice.id,
      segmented: true,
      // `chars` travels with each pending segment so the player can show an
      // honest *estimated* total length before those segments exist, and label
      // it as an estimate. The real duration replaces it as each one loads.
      segments: [
        { url: first.url, seconds: first.seconds, chars: parts[0].length },
        ...rest.map((part) => ({
          url: `${basePath}/clip/${keyFor(part)}.wav`,
          seconds: null,
          chars: part.length,
        })),
      ],
    }
  }

  /**
   * Renders (or finds) the single clip for one passage.
   * Resolves `{ url, seconds, voice, cached }`.
   */
  async function synthesize(input) {
    const { spoken, voice, engine } = await prepare(input)
    const clip = await renderChunk({ spoken, voice, engine })
    return { url: clip.url, seconds: clip.seconds, voice: clip.voice, cached: clip.cached }
  }

  /** What the client needs before it can render a picker. */
  async function info() {
    const catalogue = await voiceCatalogue()
    const voices = [...catalogue.values()]
    const chosen = await resolveVoice(defaultVoice)
    return {
      available: voices.length > 0,
      basePath,
      defaultVoice: chosen?.id ?? null,
      voices,
      engines: allEngines.map((engine) => ({
        id: engine.id,
        label: engine.label,
        available: engine.available(),
        reason: engine.unavailableReason?.() ?? null,
      })),
      reason: voices.length ? null : allEngines.map((e) => e.unavailableReason?.()).filter(Boolean).join(' '),
    }
  }

  /** Rendered ahead of a likely play. Never throws — audio is a nicety, and the
   *  caller (page generation, usually) must not fail because a model didn't. */
  async function warm(passages) {
    for (const passage of [].concat(passages)) {
      try {
        await synthesize(typeof passage === 'string' ? { text: passage } : passage)
      } catch (err) {
        onLog(`warm failed: ${err.message}`)
      }
    }
  }

  /**
   * Waits for a clip that is still being rendered.
   *
   * Segment two of a long passage is requested by the player while it is still
   * on the engine's queue, and answering 404 for "not finished yet" would make
   * the whole streaming design impossible — the URL is a content hash, so it is
   * known long before the audio exists. A request for a clip nobody is rendering
   * still 404s immediately; this only ever waits for work already in progress.
   */
  async function awaitClip(name) {
    const key = name.replace(/\.wav$/, '')
    const pending = inFlight.get(key)
    if (pending) await pending.catch(() => {})
  }

  async function serveClip(res, name, range) {
    // Path-traversal defence: the name has to look exactly like a key we made.
    if (!/^[a-f0-9]{20}\.wav$/.test(name)) return sendJson(res, 404, { error: 'No such clip.' })
    const file = path.join(cacheDir, name)
    if (!fs.existsSync(file)) await awaitClip(name)
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'That clip has expired.' })

    const size = fs.statSync(file).size
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Accept-Ranges', 'bytes')
    // Content-addressed: the bytes at this URL can never change.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

    const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? '')
    if (!match) {
      res.setHeader('Content-Length', size)
      return createReadStream(file).pipe(res)
    }

    // A seek in the scrubber becomes a Range request; without this the browser
    // downloads the whole clip before it can jump.
    const start = match[1] ? Number(match[1]) : 0
    let end = match[2] ? Number(match[2]) : size - 1
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      return res.end()
    }
    end = Math.min(end, size - 1)
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    return createReadStream(file, { start, end }).pipe(res)
  }

  /**
   * A plain Node request handler, so every adapter in this library (Vite,
   * Express, anything with a `(req, res)` signature) is a two-line wrapper
   * around the same code.
   *
   * `next` is optional: given one, a URL this service doesn't own is passed on
   * rather than 404'd, which is what a middleware mounted at `/` must do.
   */
  async function handleRequest(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // Vite and Express both strip the mount path before calling a handler, so a
    // request arrives as either `/api/read-aloud/clip/x.wav` or `/clip/x.wav`.
    const pathname = url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length) || '/'
      : url.pathname

    const clip = /^\/clip\/(.+)$/.exec(pathname)
    if (clip && req.method === 'GET') {
      return await serveClip(res, decodeURIComponent(clip[1]), req.headers?.range)
    }

    if (pathname !== '/' && pathname !== '') {
      if (next) return next()
      return sendJson(res, 404, { error: 'Not found.' })
    }

    if (req.method === 'GET') return sendJson(res, 200, await info())

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return sendJson(res, 405, { error: 'Use GET for voices, POST to synthesize.' })
    }

    try {
      const raw = await readBody(req, maxTextLength * 4)
      const payload = JSON.parse(raw || '{}')
      // `segment: true` means "start playing as soon as you can": the first
      // segment is rendered before answering, the rest while it plays.
      const result = payload.segment
        ? await synthesizeSegments(payload)
        : await synthesize(payload)
      return sendJson(res, 200, result)
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Speech synthesis failed.' })
    }
  }

  function shutdown() {
    for (const engine of allEngines) engine.stop?.()
    normalizer.stop()
  }

  return {
    basePath,
    cacheDir,
    info,
    synthesize,
    synthesizeSegments,
    awaitClip,
    warm,
    handleRequest,
    shutdown,
    engines: allEngines,
  }
}
