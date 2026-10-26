import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE,
  VOICES,
  groupVoices,
  isKnownVoice,
  parseVoiceId,
  voiceById,
  voicesForLanguages,
} from '../src/voices.js'
import { parseVoiceList } from '../src/server/engines/say.js'

describe('the Kokoro catalogue', () => {
  it('has no duplicate ids', () => {
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length)
  })

  it('qualifies every id with its engine', () => {
    expect(VOICES.every((v) => v.id.startsWith('kokoro:'))).toBe(true)
  })

  it('derives language from the first letter of the native id', () => {
    expect(voiceById('kokoro:bm_fable')).toMatchObject({
      name: 'Fable',
      lang: 'en',
      accent: 'British',
      voiceType: 'male',
    })
    expect(voiceById('kokoro:zf_xiaoni')).toMatchObject({ lang: 'zh', voiceType: 'female' })
  })

  it('ships a default that exists', () => {
    expect(isKnownVoice(DEFAULT_VOICE)).toBe(true)
  })

  it('offers English only until an app asks for more', () => {
    expect(voicesForLanguages().every((v) => v.lang === 'en')).toBe(true)
    expect(voicesForLanguages(null).length).toBe(VOICES.length)
    const romance = voicesForLanguages(['es', 'fr'])
    expect(romance.length).toBeGreaterThan(0)
    expect(new Set(romance.map((v) => v.lang))).toEqual(new Set(['es', 'fr']))
  })
})

describe('parseVoiceId', () => {
  it('splits engine from voice', () => {
    expect(parseVoiceId('say:Karen')).toEqual({ engine: 'say', nativeId: 'Karen' })
  })

  it('treats a bare id as Kokoro, which is what old stored preferences look like', () => {
    expect(parseVoiceId('bm_fable')).toEqual({ engine: 'kokoro', nativeId: 'bm_fable' })
  })

  it('keeps a name containing a colon intact', () => {
    expect(parseVoiceId('say:Eddy (English (UK))')).toEqual({
      engine: 'say',
      nativeId: 'Eddy (English (UK))',
    })
  })
})

describe('groupVoices', () => {
  it('preserves catalogue order and groups by label', () => {
    const groups = groupVoices(voicesForLanguages(['en']))
    expect(groups.map((g) => g.group)).toEqual([
      'American female',
      'American male',
      'British female',
      'British male',
    ])
  })
})

describe('parseVoiceList (macOS `say -v ?`)', () => {
  const FIXTURE = [
    'Karen               en_AU    # Hello! My name is Karen.',
    'Eddy (English (UK)) en_GB    # Hello! My name is Eddy.',
    'Rishi               en_IN    # Hello! My name is Rishi.',
    'Amélie              fr_CA    # Bonjour, je m’appelle Amélie.',
    'not a voice line',
  ].join('\n')

  it('reads name, locale and accent, including names with spaces and brackets', () => {
    const voices = parseVoiceList(FIXTURE)
    expect(voices).toHaveLength(4)
    expect(voices[0]).toMatchObject({
      id: 'say:Karen',
      nativeId: 'Karen',
      engine: 'say',
      accent: 'Australian',
      lang: 'en',
    })
    expect(voices[1]).toMatchObject({ nativeId: 'Eddy (English (UK))', name: 'Eddy', accent: 'British' })
    expect(voices[2].accent).toBe('Indian')
  })

  it('keeps the locale even when the accent has no friendly name', () => {
    expect(parseVoiceList(FIXTURE)[3]).toMatchObject({ lang: 'fr', bcp47: 'fr-CA' })
  })

  it('never marks a system voice as neural — the picker says which is which', () => {
    expect(parseVoiceList(FIXTURE).every((v) => v.neural === false)).toBe(true)
  })
})
