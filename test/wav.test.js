import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { wavSeconds } from '../src/server/service.js'

/** Builds a WAV whose chunks appear in the given order, so we can prove the
 *  duration probe walks the file rather than trusting a fixed offset. */
function buildWav({ extraChunk = false, byteRate = 44_100, dataBytes = 88_200 } = {}) {
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8) // PCM
  fmt.writeUInt16LE(1, 10) // mono
  fmt.writeUInt32LE(byteRate / 2, 12) // sample rate (16-bit mono)
  fmt.writeUInt32LE(byteRate, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)

  // macOS `say` writes a LIST chunk between `fmt ` and `data`. This is the case
  // the "canonical 44-byte header" shortcut gets silently wrong.
  const list = Buffer.alloc(8 + 10)
  list.write('LIST', 0, 'ascii')
  list.writeUInt32LE(10, 4)

  const data = Buffer.alloc(8 + dataBytes)
  data.write('data', 0, 'ascii')
  data.writeUInt32LE(dataBytes, 4)

  const body = Buffer.concat(extraChunk ? [fmt, list, data] : [fmt, data])
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + body.length, 4)
  riff.write('WAVE', 8, 'ascii')
  return Buffer.concat([riff, body])
}

const dir = mkdtempSync(path.join(tmpdir(), 'read-aloud-test-'))

function write(name, buffer) {
  const file = path.join(dir, name)
  writeFileSync(file, buffer)
  return file
}

describe('wavSeconds', () => {
  it('reads the duration of a plain PCM wav', () => {
    expect(wavSeconds(write('plain.wav', buildWav()))).toBe(2)
  })

  it('still reads it when a LIST chunk sits before the data — the `say` layout', () => {
    expect(wavSeconds(write('list.wav', buildWav({ extraChunk: true })))).toBe(2)
  })

  it('returns 0 rather than nonsense for a file that is not a wav', () => {
    expect(wavSeconds(write('nope.wav', Buffer.from('this is not audio')))).toBe(0)
  })
})
