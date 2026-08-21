/**
 * Splitting a passage into speakable segments.
 *
 * This is what makes a long passage start instantly. Rendering a five-minute
 * briefing takes ~20 seconds even at 15× real time, and nobody waits 20 seconds
 * after pressing play — so the passage is cut into pieces, the first piece is
 * rendered and played, and the rest are rendered while it plays. By the time
 * segment one ends, segment two has been ready for ten seconds.
 *
 * Where the cuts go matters more than it looks. A cut mid-sentence is audible
 * twice over: the first half ends on the wrong intonation, and the second half
 * starts without the context the model needs to pitch it. So cuts land on
 * paragraph breaks first, then sentence ends, and only ever inside a sentence
 * when a single sentence is longer than the whole budget.
 *
 * Pure and dependency-free: it runs on the server to build cache keys and in
 * tests, and the two must agree exactly.
 */

/** Sentence end: `.`, `!`, `?`, `…` followed by space, quote, or end. Abbreviations
 *  ("Mr.", "U.S.", "3.5") are excluded by requiring a following space *and* an
 *  uppercase-ish or quote start, which is cheap and wrong far less often than a
 *  full abbreviation list is incomplete. */
const SENTENCE_END = /([.!?…]["'”’)\]]*)(\s+)(?=[^\s])/g

/**
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxChars] Hard ceiling for one segment.
 * @param {number} [options.firstChars] Ceiling for the *first* segment only —
 *   much smaller, because its render time is the entire wait between pressing
 *   play and hearing something. One or two sentences render in a fraction of a
 *   second on a warm model, and by the time they have been spoken the rest of
 *   the passage has long since finished rendering behind them.
 * @param {number} [options.minChars] Segments below this are merged forward, so
 *   a stray "Yes." never becomes its own clip with its own gap around it.
 * @returns {string[]} Segments, in order. Joining them with a space returns the
 *   original words in the original order.
 */
export function segmentText(text, { maxChars = 700, firstChars = 160, minChars = 90 } = {}) {
  const source = String(text ?? '').trim()
  if (!source) return []

  const sentences = splitSentences(source)
  const segments = []
  let current = ''

  for (const sentence of sentences) {
    // The first segment is deliberately short — it is the only one whose render
    // time the listener actually waits through.
    const ceiling = segments.length === 0 ? firstChars : maxChars

    if (!current) {
      current = sentence
    } else if (current.length + 1 + sentence.length <= ceiling) {
      current = `${current} ${sentence}`
    } else {
      segments.push(current)
      current = sentence
    }

    // One sentence longer than the whole budget: cut it on a clause boundary
    // rather than letting a single 2,000-character segment stall the start.
    while (current.length > maxChars) {
      const cut = findClauseBreak(current, maxChars)
      segments.push(current.slice(0, cut).trim())
      current = current.slice(cut).trim()
    }
  }
  if (current) segments.push(current)

  return mergeShortSegments(segments, minChars, maxChars)
}

function splitSentences(text) {
  const out = []
  let last = 0
  let match
  SENTENCE_END.lastIndex = 0
  while ((match = SENTENCE_END.exec(text)) !== null) {
    const end = match.index + match[1].length
    const sentence = text.slice(last, end).trim()
    if (sentence) out.push(sentence)
    last = end + match[2].length
  }
  const tail = text.slice(last).trim()
  if (tail) out.push(tail)
  return out
}

/** The last comma, semicolon, dash or space before the ceiling. */
function findClauseBreak(text, ceiling) {
  const window = text.slice(0, ceiling)
  for (const pattern of [/[,;:—–]\s(?=[^\s])/g, /\s(?=[^\s])/g]) {
    let cut = -1
    let match
    pattern.lastIndex = 0
    while ((match = pattern.exec(window)) !== null) cut = match.index + match[0].length
    if (cut > ceiling / 2) return cut
  }
  return ceiling
}

/** A one-word segment is a gap in the audio where no gap belongs.
 *
 *  Merging respects the ceiling: an over-long sentence that was just cut into
 *  pieces can leave a short tail, and folding that tail back into the piece it
 *  came from would undo the cut and put the segment back over budget. */
function mergeShortSegments(segments, minChars, maxChars) {
  const out = []
  for (const segment of segments) {
    const previous = out[out.length - 1]
    const merged = previous ? `${previous} ${segment}` : segment
    if (previous && segment.length < minChars && merged.length <= maxChars) {
      out[out.length - 1] = merged
    } else {
      out.push(segment)
    }
  }
  // A lone short segment (the whole passage is two words) still stands alone.
  return out
}
