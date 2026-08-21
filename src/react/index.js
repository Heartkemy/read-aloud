/**
 * React entry point.
 *
 *   import { ReadAloudProvider, ReadAloud, ReadAloudPlayer } from '@athanor-code/read-aloud'
 *   import '@athanor-code/read-aloud/style.css'
 *
 * Nothing here imports Node built-ins; the server half lives behind
 * `@athanor-code/read-aloud/server`.
 */
export { ReadAloudProvider, useReadAloud, DEFAULT_RATES } from './context.jsx'
export { ReadAloud } from './ReadAloud.jsx'
export { ReadAloudPlayer } from './Player.jsx'
export { SpeakerIcon, PlayIcon, PauseIcon, StopIcon, SkipIcon, CloseIcon, LoadingDots } from './icons.jsx'
export { passageText, passageId, speakDigits, estimateSeconds, formatTime } from '../text.js'
export {
  VOICES,
  LANGUAGES,
  DEFAULT_VOICE,
  voiceById,
  isKnownVoice,
  voicesForLanguages,
  groupVoices,
} from '../voices.js'
