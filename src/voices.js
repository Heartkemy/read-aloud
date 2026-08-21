/**
 * The voice catalogue.
 *
 * Shared by both halves of the library — the browser needs labels and grouping
 * for the picker before the model has finished loading, and the server needs to
 * validate an incoming voice id before it spawns anything. Deliberately plain
 * data with no imports, so it costs a client bundle nothing.
 *
 * Every id here ships with Kokoro-82M. The naming scheme is the model's own and
 * is load-bearing rather than decorative: the first letter selects the
 * grapheme-to-phoneme front-end (feed a British voice American phonemes and you
 * hear it), and the second letter is the model's own female/male marker.
 */

/** First letter of a voice id → what language the model will phonemize it as. */
export const LANGUAGES = {
  a: { lang: 'en', accent: 'American', bcp47: 'en-US' },
  b: { lang: 'en', accent: 'British', bcp47: 'en-GB' },
  e: { lang: 'es', accent: 'Spanish', bcp47: 'es-ES' },
  f: { lang: 'fr', accent: 'French', bcp47: 'fr-FR' },
  h: { lang: 'hi', accent: 'Hindi', bcp47: 'hi-IN' },
  i: { lang: 'it', accent: 'Italian', bcp47: 'it-IT' },
  j: { lang: 'ja', accent: 'Japanese', bcp47: 'ja-JP' },
  p: { lang: 'pt', accent: 'Brazilian Portuguese', bcp47: 'pt-BR' },
  z: { lang: 'zh', accent: 'Mandarin', bcp47: 'zh-CN' },
}

/* The ids exactly as they appear in the model snapshot's `voices/` directory.
   Kept as one string rather than 54 object literals: everything else about a
   voice is derivable from its id, and a list you can read in one glance is
   easier to keep in step with the model than a list you have to scroll. */
const IDS = `
  af_alloy af_aoede af_bella af_heart af_jessica af_kore af_nicole af_nova
  af_river af_sarah af_sky
  am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa
  bf_alice bf_emma bf_isabella bf_lily
  bm_daniel bm_fable bm_george bm_lewis
  ef_dora em_alex em_santa
  ff_siwis
  hf_alpha hf_beta hm_omega hm_psi
  if_sara im_nicola
  jf_alpha jf_gongitsune jf_nezumi jf_tebukuro jm_kumo
  pf_dora pm_alex pm_santa
  zf_xiaobei zf_xiaoni zf_xiaoxiao zf_xiaoyi zm_yunjian zm_yunxi zm_yunxia
  zm_yunyang
`
  .trim()
  .split(/\s+/)

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Every voice the model ships, as `{ id, name, lang, accent, voiceType, label, group }`.
 *
 * `label` is what a picker shows ("Fable · British male"); `group` is what it
 * groups by ("British male"). Both are derived rather than hand-written so a
 * new voice id in a future model snapshot needs one word added to `IDS`.
 */
export const VOICES = IDS.map((nativeId) => {
  const meta = LANGUAGES[nativeId[0]] ?? LANGUAGES.a
  const voiceType = nativeId[1] === 'm' ? 'male' : 'female'
  const name = titleCase(nativeId.split('_')[1] ?? nativeId)
  const group = `${meta.accent} ${voiceType}`
  return {
    // Ids are engine-qualified everywhere they travel — over the API, in
    // localStorage, in an app's config. A machine can have both engines
    // installed and "Daniel" exists in each of them; without the prefix a
    // remembered preference silently points at the other one's voice.
    id: `kokoro:${nativeId}`,
    nativeId,
    engine: 'kokoro',
    neural: true,
    name,
    ...meta,
    voiceType,
    group,
    label: `${name} · ${group}`,
  }
})

const BY_ID = new Map(VOICES.map((v) => [v.id, v]))

/** The voice used when an app names none. British, unhurried, and warm — the
 *  closest thing in this model to being read to rather than announced at. */
export const DEFAULT_VOICE = 'kokoro:bm_fable'

export function voiceById(id) {
  return BY_ID.get(id) ?? null
}

/** `"kokoro:bm_fable"` → `{ engine: 'kokoro', nativeId: 'bm_fable' }`.
 *  An unqualified id is assumed to be Kokoro's, which is what every stored
 *  preference from before engines existed looks like. */
export function parseVoiceId(id) {
  const raw = String(id ?? '')
  const split = raw.indexOf(':')
  if (split === -1) return { engine: 'kokoro', nativeId: raw }
  return { engine: raw.slice(0, split), nativeId: raw.slice(split + 1) }
}

export function isKnownVoice(id) {
  return BY_ID.has(id)
}

/**
 * Voices for the given languages, in catalogue order.
 *
 * Defaults to English only. That is a *default*, not a limit: an app whose
 * content is multilingual passes `languages: ['en', 'es', 'fr']` (or `null` for
 * everything) and gets the rest of the catalogue.
 */
export function voicesForLanguages(languages = ['en']) {
  if (!languages) return VOICES
  const wanted = new Set(languages)
  return VOICES.filter((v) => wanted.has(v.lang))
}

/** `[{ group: 'British male', voices: [...] }, ...]` — ready for `<optgroup>`. */
export function groupVoices(voices = VOICES) {
  const order = []
  const byGroup = new Map()
  for (const voice of voices) {
    if (!byGroup.has(voice.group)) {
      byGroup.set(voice.group, [])
      order.push(voice.group)
    }
    byGroup.get(voice.group).push(voice)
  }
  return order.map((group) => ({ group, voices: byGroup.get(group) }))
}
