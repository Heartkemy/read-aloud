import fs from 'node:fs'
import { Readable } from 'node:stream'
import { createReadAloudService } from './service.js'

const BODY_TOO_LARGE = 'Request body too large.'

/**
 * Web-standard adapter: `Request` in, `Response` out.
 *
 * For Node-compatible Fetch runtimes such as Next's Node route handlers and
 * Hono/Bun. Cached clips use `node:fs`, so this is not an edge/Cloudflare API.
 *
 *   // app/api/read-aloud/[[...path]]/route.ts
 *   import { createReadAloudFetchHandler } from '@athanor-code/read-aloud/fetch'
 *   const readAloud = createReadAloudFetchHandler({ basePath: '/api/read-aloud' })
 *   export const GET = readAloud.GET
 *   export const POST = readAloud.POST
 *   export const OPTIONS = readAloud.OPTIONS
 *
 * The service (and therefore the warm model) is created once per module, which
 * is what a route handler module gives you for free in every one of those
 * runtimes. `handler.service` is exposed so a page can pre-render audio for text
 * it just generated.
 */
export function createReadAloudFetchHandler(options = {}) {
  const service =
    options.service ??
    createReadAloudService({
      onLog: (message) => {
        if (process.env.READ_ALOUD_DEBUG) console.log(`[read-aloud] ${message}`)
      },
      ...options,
    })
  const maxBodyBytes = (service.maxTextLength ?? options.maxTextLength ?? 20_000) * 4 + 1024

  function responseHeaders(access, initial = {}) {
    const headers = new Headers({ 'Cache-Control': 'no-store', ...initial })
    if (access?.corsOrigin) {
      headers.set('Access-Control-Allow-Origin', access.corsOrigin)
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Range')
      headers.set('Vary', 'Origin')
    }
    return headers
  }

  function json(body, status = 200, access) {
    return new Response(JSON.stringify(body), {
      status,
      headers: responseHeaders(access, { 'Content-Type': 'application/json' }),
    })
  }

  async function readJson(request) {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) throw new Error(BODY_TOO_LARGE)
    if (!request.body) return {}

    const reader = request.body.getReader()
    const chunks = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBodyBytes) {
          await reader.cancel()
          throw new Error(BODY_TOO_LARGE)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(body))
  }

  async function clipResponse(name, rangeHeader, access) {
    // Path-traversal defence: the name has to look exactly like a key we made.
    if (!/^[a-f0-9]{20}\.wav$/.test(name)) return json({ error: 'No such clip.' }, 404, access)
    const file = `${service.cacheDir}/${name}`
    if (!fs.existsSync(file)) await service.awaitClip(name)
    if (!fs.existsSync(file)) return json({ error: 'That clip has expired.' }, 404, access)

    const size = fs.statSync(file).size
    const headers = responseHeaders(access, {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      // Content-addressed names are not authorization. Audio may contain private text.
      'Cache-Control': 'private, no-store',
    })

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '')
    if (!match) {
      const stream = Readable.toWeb(fs.createReadStream(file))
      headers.set('Content-Length', String(size))
      return new Response(stream, { headers })
    }

    // A seek in the scrubber becomes a Range request; without this the browser
    // downloads the whole clip before it can jump.
    const start = match[1] ? Number(match[1]) : 0
    let end = match[2] ? Number(match[2]) : size - 1
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    end = Math.min(end, size - 1)
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }))
    return new Response(stream, {
      status: 206,
      headers: responseHeaders(access, {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      }),
    })
  }

  async function handle(request) {
    const url = new URL(request.url)
    const access = service.authorizeRequest({
      host: url.host,
      origin: request.headers.get('origin'),
      protocol: url.protocol,
      fetchSite: request.headers.get('sec-fetch-site'),
    })
    if (!access.allowed) return json({ error: access.error }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(access) })

    const pathname = url.pathname.startsWith(service.basePath)
      ? url.pathname.slice(service.basePath.length) || '/'
      : url.pathname

    if (pathname === '/warm') return json(service.keepWarm(), 200, access)

    const clip = /^\/clip\/(.+)$/.exec(pathname)
    if (clip) {
      if (request.method !== 'GET') return json({ error: 'GET only.' }, 405, access)
      let name
      try {
        name = decodeURIComponent(clip[1])
      } catch {
        return json({ error: 'No such clip.' }, 404, access)
      }
      return clipResponse(name, request.headers.get('range'), access)
    }

    if (pathname !== '/' && pathname !== '') return json({ error: 'Not found.' }, 404, access)
    if (request.method === 'GET') return json(await service.info(), 200, access)
    if (request.method !== 'POST') return json({ error: 'Use GET for voices, POST to synthesize.' }, 405, access)

    try {
      const payload = await readJson(request)
      return json(await service.synthesize(payload), 200, access)
    } catch (err) {
      return json({ error: err.message || 'Speech synthesis failed.' }, err.message === BODY_TOO_LARGE ? 413 : 500, access)
    }
  }

  return { handle, GET: handle, POST: handle, OPTIONS: handle, service }
}

export default createReadAloudFetchHandler
