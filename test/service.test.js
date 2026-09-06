import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CALM_PAUSE, DEFAULT_PAUSE, createReadAloudService } from '../src/server/service.js'

/** A real, parseable 1-second PCM wav — enough for the cache and duration probe
 *  to behave like a model render without one being present. */
function wavBytes() {
  const dataBytes = 16000 // 1 s of 8 kHz mono 16-bit
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

const dir = mkdtempSync(path.join(tmpdir(), 'read-aloud-breathe-'))

function makeService(seen) {
  const service = createReadAloudService({
    basePath: '/api/read-aloud',
    cacheDir: dir,
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
        render: async ({ text, out, pause }) => {
          seen.push({ text, pause })
          writeFileSync(out, wavBytes())
          return { seconds: 1 }
        },
      },
    ],
  })
  return service
}

describe('pause breathing through the service', () => {
  it('defaults every read to the gentle pause and caches calm separately', async () => {
    const seen = []
    const service = makeService(seen)
    try {
      const normal = await service.synthesize({ text: 'Hello world, read this calmly.', voice: 'stub:v' })
      const calm = await service.synthesize({ text: 'Hello world, read this calmly.', voice: 'stub:v', calm: true })

      expect(seen.map((r) => r.pause)).toEqual([DEFAULT_PAUSE, CALM_PAUSE])
      expect(calm.url).not.toBe(normal.url)
      expect(readdirSync(dir).filter((n) => n.endsWith('.wav'))).toHaveLength(2)
    } finally {
      service.shutdown()
    }
  })

  it('an explicit breathe overrides calm and the default', async () => {
    const seen = []
    const service = makeService(seen)
    try {
      await service.synthesize({ text: 'Another passage for the cache.', voice: 'stub:v', breathe: 0.4 })
      expect(seen.at(-1).pause).toBe(0.4)
    } finally {
      service.shutdown()
    }
  })
})
