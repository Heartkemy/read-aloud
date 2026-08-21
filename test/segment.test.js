import { describe, expect, it } from 'vitest'
import { segmentText } from '../src/segment.js'

const words = (segments) => segments.join(' ').split(/\s+/)

describe('segmentText', () => {
  it('keeps every word, in order — a segmenter that drops a clause is a liar', () => {
    const text =
      'Sending is paused. That is five messages the screen has stopped. None of them reached the ' +
      'other parent. This pause is for you, not against you.'
    expect(words(segmentText(text)).join(' ')).toBe(text.split(/\s+/).join(' '))
  })

  it('starts with a short segment, because that is the only wait anyone feels', () => {
    const sentence = 'The quick brown fox jumped over the lazy dog again and again. '
    const [first] = segmentText(sentence.repeat(20), { firstChars: 120, maxChars: 700 })
    expect(first.length).toBeLessThanOrEqual(120)
  })

  it('cuts on sentence ends, never mid-sentence, while sentences fit', () => {
    const text = 'One two three four five. Six seven eight nine ten. Eleven twelve thirteen.'
    for (const segment of segmentText(text, { firstChars: 30, maxChars: 30, minChars: 0 })) {
      expect(segment).toMatch(/[.!?]$/)
    }
  })

  it('does not treat a decimal or an abbreviation as a sentence end', () => {
    const text = 'The level sits at 3.5 dollars after Mr. Smith sold. That is the whole story.'
    expect(segmentText(text, { firstChars: 400, maxChars: 400 })).toHaveLength(1)
  })

  it('breaks a single over-long sentence on a clause boundary rather than mid-word', () => {
    const monster = `It rose ${'and rose, '.repeat(60)}and then it stopped.`
    const segments = segmentText(monster, { firstChars: 200, maxChars: 200 })
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every((s) => s.length <= 200)).toBe(true)
    expect(words(segments).join(' ')).toBe(monster.split(/\s+/).join(' '))
  })

  it('merges a stray fragment into its neighbour rather than making it a clip', () => {
    const segments = segmentText('Yes. ' + 'A much longer sentence that carries the passage. '.repeat(4), {
      firstChars: 200,
      maxChars: 200,
      minChars: 40,
    })
    expect(segments[0].startsWith('Yes. A much longer')).toBe(true)
  })

  it('is empty for nothing, so a caller can skip the request entirely', () => {
    expect(segmentText('')).toEqual([])
    expect(segmentText(null)).toEqual([])
  })
})
