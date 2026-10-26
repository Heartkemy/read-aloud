import { describe, expect, it } from 'vitest'
import { estimateSeconds, formatTime, passageId, passageText, speakDigits } from '../src/text.js'

describe('passageText', () => {
  it('collapses the whitespace JSX leaves in a template literal', () => {
    expect(passageText('  The ferry departs at nine.\n   Tickets are at the kiosk.  ')).toBe(
      'The ferry departs at nine. Tickets are at the kiosk.',
    )
  })

  it('keeps a blank line between paragraphs, because that is the pause', () => {
    expect(passageText('One.\n\n\nTwo.')).toBe('One.\n\nTwo.')
  })

  it('joins an array as paragraphs so [title, body] reads with a break', () => {
    expect(passageText(['Ferry schedule', 'Boarding begins at nine.'])).toBe('Ferry schedule\n\nBoarding begins at nine.')
  })

  it('flattens nested arrays and drops the falsy branches of a conditional', () => {
    const showWhy = false
    expect(passageText(['Title', ['Body', showWhy && 'Why'], null, undefined])).toBe(
      'Title\n\nBody',
    )
  })

  it('is empty for nothing at all, so a button can decline to render', () => {
    expect(passageText(null)).toBe('')
    expect(passageText([false, null, '  '])).toBe('')
  })

  it('refuses React elements rather than speaking "[object Object]"', () => {
    expect(() => passageText({ type: 'p', props: {} })).toThrow(TypeError)
  })
})

describe('speakDigits', () => {
  it('spells a numeric code out so it can be written down', () => {
    expect(speakDigits('314 159 265')).toBe('3 1 4, 1 5 9, 2 6 5')
  })

  it('leaves a single group alone apart from the spacing', () => {
    expect(speakDigits('000')).toBe('0 0 0')
  })
})

describe('passageId', () => {
  it('is stable for the same text, so a re-render keeps the button lit', () => {
    expect(passageId('Boarding begins at nine.')).toBe(passageId('Boarding begins at nine.'))
  })

  it('differs for different text, so two paragraphs are never confused', () => {
    expect(passageId('One.')).not.toBe(passageId('Two.'))
  })

  it('takes a prefix for call sites that want readable ids', () => {
    expect(passageId('One.', 'msg')).toMatch(/^msg-/)
  })
})

describe('estimateSeconds', () => {
  it('scales with length and with playback rate', () => {
    const words = 'word '.repeat(165).trim()
    expect(estimateSeconds(words)).toBeCloseTo(60, 0)
    expect(estimateSeconds(words, { rate: 2 })).toBeCloseTo(30, 0)
  })

  it('is zero for nothing, not NaN', () => {
    expect(estimateSeconds('')).toBe(0)
  })
})

describe('formatTime', () => {
  it('pads the seconds and never shows a negative clock', () => {
    expect(formatTime(9)).toBe('0:09')
    expect(formatTime(75)).toBe('1:15')
    expect(formatTime(-4)).toBe('0:00')
    expect(formatTime(NaN)).toBe('0:00')
  })
})
