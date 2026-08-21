#!/usr/bin/env node
/**
 * Renders one sentence in every available voice and ranks them by measured
 * calmness, so "which voice should this app default to?" has an answer that
 * isn't somebody's taste at 1 a.m.
 *
 *   node scripts/rank-voices.mjs [outputDir] [--text "..."]
 *
 * Writes one WAV per voice plus a manifest, then hands both to
 * `python/rank_voices.py`, which measures speaking rate, pitch variation and
 * loudness variation and prints a ranked table with the top two per accent.
 *
 * The analysis needs numpy, which lives in the neural engine's virtualenv
 * (`npx read-aloud-setup`). The rendering half works with only the macOS voices.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReadAloudService } from '../src/server/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const textFlag = args.indexOf('--text')
const OUT = path.resolve(args.find((a, i) => !a.startsWith('--') && i !== textFlag + 1) ?? 'voice-samples')
const LINE =
  textFlag === -1
    ? 'The moment before you send is the moment that matters. Nine minutes is usually enough for the worst of it to pass, and nothing here is recorded.'
    : args[textFlag + 1]

const service = createReadAloudService({ languages: ['en'] })
const info = await service.info()
if (!info.available) {
  console.error(`read-aloud: no engine available. ${info.reason ?? ''}`)
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })
const rendered = []

for (const voice of info.voices) {
  try {
    const clip = await service.synthesize({ text: LINE, voice: voice.id })
    const source = path.join(service.cacheDir, path.basename(clip.url))
    const file = path.join(OUT, `${voice.id.replace(/[:/]/g, '_')}.wav`)
    fs.copyFileSync(source, file)
    rendered.push({ ...voice, file, seconds: clip.seconds })
    process.stdout.write(`  rendered ${voice.id} (${clip.seconds}s)\n`)
  } catch (err) {
    process.stdout.write(`  skipped  ${voice.id}: ${err.message}\n`)
  }
}

fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify({ text: LINE, words: LINE.split(/\s+/).length, voices: rendered }, null, 2),
)
service.shutdown()

const python = process.env.READ_ALOUD_PYTHON ?? path.join(homedir(), '.cache', 'read-aloud', 'venv', 'bin', 'python')
if (!fs.existsSync(python)) {
  console.log(`\n${rendered.length} samples written to ${OUT}.`)
  console.log('Install the neural engine (npx read-aloud-setup) to also get the ranking, or just listen.')
  process.exit(0)
}

console.log('')
spawnSync(python, [path.join(HERE, '..', 'python', 'rank_voices.py'), OUT], { stdio: 'inherit' })
