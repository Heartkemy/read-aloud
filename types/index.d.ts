/**
 * Types for the React entry point (`@athanor-code/read-aloud`).
 *
 * Hand-written rather than generated: the package is plain JavaScript, and a
 * small declaration file that says exactly what the public API is beats a build
 * step that emits `any` in the interesting places.
 */
import type { ReactNode, SVGProps } from 'react'

export type EngineId = 'kokoro' | 'say' | (string & {})

export interface Voice {
  /** Engine-qualified: `"say:Karen"`, `"kokoro:bm_fable"`. */
  id: string
  /** The id the engine itself uses, without the prefix. */
  nativeId: string
  engine: EngineId
  /** Display name — "Karen", "Fable". */
  name: string
  /** BCP-47 language subtag: `"en"`, `"es"`. */
  lang: string
  /** "Australian", "British", "American"… */
  accent: string
  bcp47: string
  /** Grouping label for a picker: "British male", "Australian · system". */
  group: string
  label: string
  voiceType?: 'male' | 'female'
  neural: boolean
  novelty?: boolean
}

export type PlaybackStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'ended' | 'error'

export interface Passage {
  id: string
  text: string
  title?: string | null
  /** Spoken-only lead-in, never displayed. */
  intro?: string | null
}

export interface ReadAloudState {
  /** `null` until the service has answered; `false` disables every button. */
  available: boolean | null
  unavailableReason: string | null
  voices: Voice[]
  endpoint: string
  passage: Passage | null
  activeId: string | null
  status: PlaybackStatus
  error: string | null
  /** Elapsed and total seconds across the whole passage, not the current
   *  segment's own clock. */
  time: number
  duration: number
  /** True while any segment is still rendering and its length is an estimate. */
  estimated: boolean
  segments: Array<{ url: string; seconds: number | null; chars: number | null }>
  segmentIndex: number
  voice: string
  rate: number
  rates: number[]
  /** Calm reading: slower default rate and heavier pauses between sentences.
   *  Turning it on re-reads the current passage so the pauses land. */
  calm: boolean
  skipSeconds: number
  speak(input: { id?: string; text: PassageInput; title?: string; intro?: string }): void
  toggle(): void
  pause(): void
  resume(): void
  stop(): void
  seek(seconds: number): void
  skip(delta: number): void
  setRate(rate: number): void
  cycleRate(): void
  setVoice(voiceId: string): void
  toggleCalm(): void
}

export type PassageInput = string | number | null | undefined | false | PassageInput[]

export interface ReadAloudProviderProps {
  children?: ReactNode
  /** Where the API is mounted. Must match the server's `basePath`. */
  endpoint?: string
  /** This app's default voice, before the listener picks one. */
  voice?: string
  rates?: number[]
  /** Namespace for remembered settings in localStorage. */
  storagePrefix?: string
  skipSeconds?: number
}

export function ReadAloudProvider(props: ReadAloudProviderProps): JSX.Element

export interface ReadAloudProps {
  text: PassageInput
  /** What the player calls this passage. */
  title?: string | null
  id?: string
  label?: string
  size?: number
  className?: string
  intro?: string
  /** `list` draws the play-all glyph — for the control that reads a whole list
   *  whose items each have their own button. */
  variant?: 'passage' | 'list'
}

export function ReadAloud(props: ReadAloudProps): JSX.Element | null

export interface ReadAloudPlayerProps {
  placement?: 'fixed' | 'inline'
  voicePicker?: boolean
  speedControl?: boolean
  calmControl?: boolean
  className?: string
}

export function ReadAloudPlayer(props: ReadAloudPlayerProps): JSX.Element | null

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }
export function SpeakerIcon(props: IconProps): JSX.Element
export function PlayIcon(props: IconProps): JSX.Element
export function PauseIcon(props: IconProps): JSX.Element
export function StopIcon(props: IconProps): JSX.Element
export function CloseIcon(props: IconProps): JSX.Element
export function ChevronIcon(props: IconProps): JSX.Element
export function PlayAllIcon(props: IconProps): JSX.Element
export function SkipIcon(props: IconProps & { seconds?: number; back?: boolean }): JSX.Element
export function LoadingDots(props: { size?: number }): JSX.Element

/** `null` outside a provider, so a shared component can render a button safely. */
export function useReadAloud(): ReadAloudState | null

export const DEFAULT_RATES: number[]
export const DEFAULT_VOICE: string
export const VOICES: Voice[]
export const LANGUAGES: Record<string, { lang: string; accent: string; bcp47: string }>

export function voiceById(id: string): Voice | null
export function isKnownVoice(id: string): boolean
export function voicesForLanguages(languages?: string[] | null): Voice[]
export function groupVoices(voices?: Voice[]): Array<{ group: string; voices: Voice[] }>

export function passageText(input: PassageInput): string
export function passageId(text: string, prefix?: string): string
export function speakDigits(value: string | number): string
export function estimateSeconds(
  text: PassageInput,
  options?: { wordsPerMinute?: number; rate?: number },
): number
export function formatTime(seconds: number): string
