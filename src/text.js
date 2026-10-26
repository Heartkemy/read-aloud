/**
 * Turning what a component has into what a voice should say.
 *
 * Pure, dependency-free, and tested — it runs in the browser (to build the
 * passage) and on the server (to build the cache key), and those two have to
 * agree exactly or every play is a cache miss.
 */

/**
 * Collapses everything inside one paragraph to single spaces.
 *
 * Single newlines included, which is the common case rather than an edge one:
 * prose written in JSX is wrapped by the editor, so the string a component
 * holds is full of line breaks that mean nothing to a reader and become audible
 * pauses to a speech engine. Paragraph breaks survive because they are split
 * off before this runs. Non-breaking spaces collapse too — they are typography,
 * not speech.
 */
function tidy(line) {
  return String(line).replace(/\s+/g, ' ').trim()
}

/**
 * Normalizes whatever a call site has into a single spoken passage.
 *
 * Accepts a string, a number, or an arbitrarily nested array of them, and drops
 * `null` / `undefined` / `false` so a call site can write
 * `[title, subtitle, showWhy && why]` without ceremony. Array items are joined
 * with a blank line, which every TTS front-end reads as a paragraph break —
 * that pause is the difference between two sentences and one run-on.
 *
 * Deliberately *not* a DOM scraper. Harvesting `textContent` from a ref is one
 * line shorter and always wrong in the end: it picks up button labels, icon
 * alt text and timestamps, and it reads whatever happens to be expanded rather
 * than what the passage is. Call sites name their own text.
 */
export function passageText(input) {
  if (input === null || input === undefined || input === false) return ''
  if (Array.isArray(input)) {
    return input
      .map((part) => passageText(part))
      .filter(Boolean)
      .join('\n\n')
  }
  if (typeof input === 'object') {
    throw new TypeError(
      'passageText() takes strings, numbers, or arrays of them — not objects or React elements.',
    )
  }
  return String(input)
    .split(/\n{2,}/)
    .map(tidy)
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Spells a number out digit by digit: "314 159 265" → "3 1 4, 1 5 9, 2 6 5".
 *
 * Speech engines read a run of digits as a quantity — a numeric code becomes
 * "three hundred and fourteen", which is useless to someone trying to write it
 * down. Grouping is preserved as commas because the pause makes a spoken number
 * transcribable.
 */
export function speakDigits(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((group) => group.split('').join(' '))
    .join(', ')
}

/**
 * A stable id for a passage, so a button knows whether the thing currently
 * playing is *its* passage.
 *
 * Content-derived on purpose: React keys and array indices change when a list
 * reorders, and the player would then attribute the audio to the wrong
 * paragraph. FNV-1a — not a security hash, just a short, fast, well-spread one.
 */
export function passageId(text, prefix = 'p') {
  let hash = 0x811c9dc5
  const source = String(text)
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`
}

/**
 * Roughly how long this will take to speak, for the "preparing" state.
 *
 * Only ever an estimate, and labelled as one wherever it is shown: the real
 * duration arrives with the clip. 165 wpm is Kokoro's measured conversational
 * pace, close enough for a progress hint and never used for seeking.
 */
export function estimateSeconds(text, { wordsPerMinute = 165, rate = 1 } = {}) {
  const words = passageText(text).split(/\s+/).filter(Boolean).length
  if (!words) return 0
  return Number(((words / wordsPerMinute) * 60) / rate).toFixed(2) * 1
}

/** "4:07". Used by the player and by anything reporting a clip length. */
export function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}
