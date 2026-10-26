import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * The macOS system engine — `say`, the speech synthesizer already on the Mac.
 *
 * It exists for two reasons, and the second one is the important one:
 *
 * 1. **Accents Kokoro doesn't have.** Kokoro's English is American and British,
 *    full stop. macOS ships Australian, Indian, Irish, Scottish and South
 *    African English, which for an app with an Australian audience is not a
 *    nice-to-have.
 * 2. **Zero setup.** No Python, no virtualenv, no 350 MB model — `npm install`
 *    and the feature works. The neural engine is then an upgrade someone opts
 *    into, not a wall they hit on the first run.
 *
 * The trade-off is honest and worth stating in a picker: these are concatenative
 * / older parametric voices and they sound it next to a neural one. Which is why
 * both engines are offered rather than one replacing the other.
 */

const SAY = '/usr/bin/say'

/* macOS reports a BCP-47-ish locale per voice and nothing else — no accent
   name, no gender. The accent label is the one thing a listener actually picks
   by, so it is mapped here rather than shown as "en_AU". */
const ACCENTS = {
  en_AU: 'Australian',
  en_GB: 'British',
  en_US: 'American',
  en_IN: 'Indian',
  en_IE: 'Irish',
  en_ZA: 'South African',
  en_NZ: 'New Zealand',
  en_SC: 'Scottish',
}

/**
 * `Karen               en_AU    # Hello! My name is Karen.`
 *
 * The name column is padded to 20 characters, so most lines have a run of
 * spaces before the locale — but a long name ("Eddy (English (UK))") overflows
 * the column and leaves exactly one. Splitting on two-or-more spaces therefore
 * silently drops eight of this machine's British voices, which is how this was
 * first written. The name is matched lazily instead, up to the first token that
 * looks like a locale *and* is followed by the comment marker; a name with
 * spaces in it ("Bad News") survives that, because nothing inside it looks like
 * a locale.
 */
const VOICE_LINE = /^(.+?)\s+([a-z]{2,3})[-_]([A-Za-z]{2,4})\s+#\s?(.*)$/

/**
 * Voices macOS ships for fun or from a much older synthesizer generation:
 * musical instruments, robots, a sheep, and the 1990s-era diphone voices.
 *
 * Hidden by default rather than deleted. They are genuinely charming and a
 * couple of them are useful (Whisper), but a picker where "Boing" sits between
 * two real voices reads as unfinished — and in an app doing something serious,
 * offering to read a ferry schedule in "Jester" is worse than that. Apps that
 * want them pass `includeNovelty: true`.
 */
export const NOVELTY_VOICES = new Set([
  'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Deranged',
  'Good News', 'Hysterical', 'Jester', 'Organ', 'Pipe Organ', 'Superstar',
  'Trinoids', 'Whisper', 'Wobble', 'Zarvox',
  // Pre-2010 diphone voices: intelligible, but audibly a different era.
  'Bruce', 'Fred', 'Junior', 'Kathy', 'Princess', 'Ralph', 'Agnes', 'Vicki', 'Victoria',
])

export function parseVoiceList(stdout) {
  return stdout
    .split('\n')
    .map((line) => VOICE_LINE.exec(line.trimEnd()))
    .filter(Boolean)
    .map(([, rawName, lang, region, sample]) => {
      const name = rawName.trim()
      const locale = `${lang}_${region.toUpperCase()}`
      const accent = ACCENTS[locale] ?? region.toUpperCase()
      // "Eddy (English (UK))" is how macOS disambiguates one name across two
      // locales; the bracket is addressing, not part of what to call the voice.
      const display = name.replace(/\s*\(.*\)$/, '')
      return {
        id: `say:${name}`,
        nativeId: name,
        engine: 'say',
        neural: false,
        novelty: NOVELTY_VOICES.has(display),
        name: display,
        lang,
        accent,
        bcp47: `${lang}-${region.toUpperCase()}`,
        group: `${accent} · system`,
        label: `${display} · ${accent}`,
        sample,
      }
    })
}

export function createSayEngine({ languages = ['en'], includeNovelty = false } = {}) {
  let cached = null

  function available() {
    return process.platform === 'darwin' && existsSync(SAY)
  }

  function unavailableReason() {
    return available() ? null : 'The macOS `say` command is only available on macOS.'
  }

  async function voices() {
    if (!available()) return []
    if (cached) return cached
    try {
      // `say -v '?'` is a few milliseconds and the answer only changes when
      // someone installs a voice in System Settings, so it is read once per
      // server process.
      const { stdout } = await run(SAY, ['-v', '?'], { maxBuffer: 1024 * 1024 })
      const all = parseVoiceList(stdout).filter((v) => includeNovelty || !v.novelty)
      const wanted = languages ? all.filter((v) => languages.includes(v.lang)) : all
      // macOS lists some voices twice — the same name and locale, once per
      // installed quality tier. `say -v` takes the name, so the duplicate is
      // not addressable and would only show up as a repeated row in a picker.
      cached = [...new Map(wanted.map((voice) => [voice.id, voice])).values()]
    } catch {
      cached = []
    }
    return cached
  }

  /**
   * `say` writes AIFF unless told otherwise; `--file-format`/`--data-format`
   * give a plain 16-bit PCM WAV, which is what the browser and the duration
   * probe both want. Text goes via a file, never argv: a passage containing a
   * quote character is not an edge case, it is Tuesday.
   */
  async function render({ text, out, voice, speed = 1 }) {
    const { writeFile, rm } = await import('node:fs/promises')
    const textPath = `${out}.txt`
    await writeFile(textPath, text, 'utf8')
    try {
      const args = [
        '-v',
        String(voice ?? '').replace(/^say:/, ''),
        '-o',
        out,
        '--file-format=WAVE',
        '--data-format=LEI16@22050',
        '-f',
        textPath,
      ]
      // `say`'s own rate is words-per-minute, and re-rendering for a speed
      // change would throw away the cached clip. Speed stays a playback concern
      // in the browser, where it is instant and pitch-corrected.
      if (speed && speed !== 1) args.splice(1, 0, '-r', String(Math.round(175 * speed)))
      await run(SAY, args, { cwd: path.dirname(out) })
      return { ok: true, voice }
    } finally {
      await rm(textPath, { force: true })
    }
  }

  return {
    id: 'say',
    label: 'macOS system voices',
    available,
    unavailableReason,
    voices,
    render,
    stop: () => {},
    warm: true,
  }
}
