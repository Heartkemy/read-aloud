import http from 'node:http'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createReadAloudFetchHandler } from '../src/server/fetch.js'
import { createReadAloudService } from '../src/server/service.js'

function wavBytes() {
  const dataBytes = 16000
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(8000, 24)
  buf.writeUInt32LE(16000, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  return buf
}

function makeService(options = {}) {
  return createReadAloudService({
    basePath: '/api/read-aloud',
    cacheDir: mkdtempSync(path.join(tmpdir(), 'read-aloud-access-')),
    languages: null,
    warmOnLoad: false,
    onLog: () => {},
    engines: [
      {
        id: 'stub',
        label: 'Stub',
        available: () => true,
        voices: async () => [
          { id: 'stub:v', nativeId: 'v', engine: 'stub', name: 'V', group: 'G', label: 'V · G' },
        ],
        render: async ({ out }) => {
          writeFileSync(out, wavBytes())
          return { seconds: 1 }
        },
      },
    ],
    ...options,
  })
}

async function withServer(service, run, next) {
  const server = http.createServer((req, res) => service.handleRequest(req, res, next && (() => next(req, res))))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(server.address().port)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    service.shutdown()
  }
}

function request(port, { method = 'GET', pathname = '/api/read-aloud', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('local service access', () => {
  it('requires a loopback peer and host, rejects foreign origins, and never publicly caches audio', async () => {
    const service = makeService()
    expect(
      service.authorizeRequest({
        host: 'localhost:3000',
        remoteAddress: '203.0.113.10',
        requireLoopbackPeer: true,
      }),
    ).toMatchObject({ allowed: false })

    await withServer(service, async (port) => {
      const host = `localhost:${port}`
      expect((await request(port, { headers: { Host: host } })).status).toBe(200)
      expect((await request(port, { headers: { Host: 'example.test' } })).status).toBe(403)
      expect(
        (await request(port, { headers: { Host: host, Origin: 'https://attacker.example' } })).status,
      ).toBe(403)
      expect((await request(port, { headers: { Host: host, Origin: `https://${host}` } })).status).toBe(403)
      expect((await request(port, { headers: { Host: host, Origin: `http://${host}` } })).status).toBe(200)

      const clip = await service.synthesize({ text: 'A synthetic sample for cache tests.', voice: 'stub:v' })
      const audio = await request(port, { pathname: clip.url, headers: { Host: host } })
      expect(audio.status).toBe(200)
      expect(audio.headers['cache-control']).toBe('private, no-store')
      expect(statSync(service.cacheDir).mode & 0o777).toBe(0o700)
      expect(statSync(path.join(service.cacheDir, path.basename(clip.url))).mode & 0o777).toBe(0o600)
      expect((await request(port, { pathname: '/api/read-aloud/clip/%E0%A4%A', headers: { Host: host } })).status).toBe(404)
    })
  })

  it('caps Node request bodies and leaves unrelated preflights to the next middleware', async () => {
    const limited = makeService({ maxTextLength: 8 })
    await withServer(limited, async (port) => {
      const response = await request(port, {
        method: 'POST',
        headers: { Host: `localhost:${port}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(2_000) }),
      })
      expect(response.status).toBe(413)
    })

    const service = makeService()
    await withServer(
      service,
      async (port) => {
        expect((await request(port, { method: 'OPTIONS', pathname: '/unrelated', headers: { Host: `localhost:${port}` } })).status).toBe(299)
      },
      (_req, res) => {
        res.statusCode = 299
        res.end()
      },
    )
  })

  it('permits only explicitly configured sidecar origins and returns narrow CORS headers', async () => {
    const service = makeService({ allowedOrigins: ['app://obsidian.md'] })
    await withServer(service, async (port) => {
      const host = `localhost:${port}`
      const allowed = await request(port, { headers: { Host: host, Origin: 'app://obsidian.md' } })
      expect(allowed.status).toBe(200)
      expect(allowed.headers['access-control-allow-origin']).toBe('app://obsidian.md')
      expect((await request(port, { headers: { Host: host, Origin: 'app://other.local' } })).status).toBe(403)

      const preflight = await request(port, {
        method: 'OPTIONS',
        headers: { Host: host, Origin: 'app://obsidian.md' },
      })
      expect(preflight.status).toBe(204)
      expect(preflight.headers['access-control-allow-methods']).toContain('POST')
    })
  })

  it('accepts standard IPv6 loopback authorities but rejects malformed host headers', () => {
    const service = makeService()
    try {
      expect(
        service.authorizeRequest({
          host: '[::1]:3000',
          remoteAddress: '::1',
          requireLoopbackPeer: true,
        }),
      ).toMatchObject({ allowed: true })

      for (const host of ['user@localhost:3000', 'localhost:3000/path', 'localhost:3000?query']) {
        expect(service.authorizeRequest({ host, remoteAddress: '127.0.0.1', requireLoopbackPeer: true })).toMatchObject({
          allowed: false,
        })
      }
    } finally {
      service.shutdown()
    }
  })

  it('applies the loopback and sidecar rules to the Fetch adapter', async () => {
    const blocked = createReadAloudFetchHandler({ service: makeService() })
    expect((await blocked.GET(new Request('https://example.test/api/read-aloud'))).status).toBe(403)
    blocked.service.shutdown()

    const handler = createReadAloudFetchHandler({ service: makeService({ allowedOrigins: ['app://obsidian.md'] }) })
    const preflight = await handler.OPTIONS(
      new Request('http://localhost/api/read-aloud', {
        method: 'OPTIONS',
        headers: { Origin: 'app://obsidian.md' },
      }),
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('app://obsidian.md')
    expect(
      (await handler.GET(new Request('http://localhost/api/read-aloud', { headers: { Origin: 'https://attacker.example' } })))
        .status,
    ).toBe(403)
    expect(
      (await handler.GET(new Request('http://localhost/api/read-aloud', { headers: { Origin: 'https://localhost' } }))).status,
    ).toBe(403)
    expect((await handler.GET(new Request('http://localhost/api/read-aloud', { headers: { Origin: 'http://localhost' } }))).status).toBe(200)
    expect((await handler.GET(new Request('http://localhost/api/read-aloud/clip/%E0%A4%A'))).status).toBe(404)
    handler.service.shutdown()
  })

  it('caps Fetch request bodies before JSON parsing', async () => {
    const handler = createReadAloudFetchHandler({ service: makeService({ maxTextLength: 8 }) })
    try {
      const response = await handler.POST(
        new Request('http://localhost/api/read-aloud', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'x'.repeat(2_000) }),
        }),
      )
      expect(response.status).toBe(413)
    } finally {
      handler.service.shutdown()
    }
  })
})
