import fs from 'node:fs'
import { Readable } from 'node:stream'
import { createReadAloudService } from './service.js'

/**
 * Web-standard adapter: `Request` in, `Response` out.
 *
 * For Next.js route handlers, Hono, Bun, Deno, Cloudflare-style runtimes — any
 * host whose handler signature is the fetch API rather than Node's `(req, res)`.
 *
 *   // app/api/read-aloud/[[...path]]/route.ts
 *   import { createReadAloudFetchHandler } from '@athanor-code/read-aloud/fetch'
 *   const readAloud = createReadAloudFetchHandler({ basePath: '/api/read-aloud' })
 *   export const GET = readAloud.GET
 *   export const POST = readAloud.POST
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

  function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function clipResponse(name, rangeHeader) {
    // Path-traversal defence: the name has to look exactly like a key we made.
    if (!/^[a-f0-9]{20}\.wav$/.test(name)) return json({ error: 'No such clip.' }, 404)
    const file = `${service.cacheDir}/${name}`
    if (!fs.existsSync(file)) return json({ error: 'That clip has expired.' }, 404)

    const size = fs.statSync(file).size
    const headers = {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      // Content-addressed: the bytes at this URL can never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '')
    if (!match) {
      const stream = Readable.toWeb(fs.createReadStream(file))
      return new Response(stream, { headers: { ...headers, 'Content-Length': String(size) } })
    }

    // A seek in the scrubber becomes a Range request; without this the browser
    // downloads the whole clip before it can jump.
    const start = match[1] ? Number(match[1]) : 0
    let end = match[2] ? Number(match[2]) : size - 1
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    end = Math.min(end, size - 1)
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }))
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    })
  }

  async function handle(request) {
    const url = new URL(request.url)
    const pathname = url.pathname.startsWith(service.basePath)
      ? url.pathname.slice(service.basePath.length) || '/'
      : url.pathname

    if (pathname === '/warm') return json(service.keepWarm())

    const clip = /^\/clip\/(.+)$/.exec(pathname)
    if (clip) {
      if (request.method !== 'GET') return json({ error: 'GET only.' }, 405)
      return clipResponse(decodeURIComponent(clip[1]), request.headers.get('range'))
    }

    if (pathname !== '/' && pathname !== '') return json({ error: 'Not found.' }, 404)
    if (request.method === 'GET') return json(await service.info())
    if (request.method !== 'POST') return json({ error: 'Use GET for voices, POST to synthesize.' }, 405)

    try {
      const payload = await request.json().catch(() => ({}))
      return json(await service.synthesize(payload))
    } catch (err) {
      return json({ error: err.message || 'Speech synthesis failed.' }, 500)
    }
  }

  return { handle, GET: handle, POST: handle, service }
}

export default createReadAloudFetchHandler
