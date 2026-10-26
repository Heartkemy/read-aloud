export type EngineId = 'kokoro' | 'say' | (string & {})

export interface Voice {
  id: string
  nativeId: string
  engine: EngineId
  name: string
  lang: string
  accent: string
  bcp47: string
  group: string
  label: string
  voiceType?: 'male' | 'female'
  neural: boolean
  novelty?: boolean
  sample?: string
}

export const LANGUAGES: Record<string, { lang: string; accent: string; bcp47: string }>
export const VOICES: Voice[]
export const DEFAULT_VOICE: string
export function voiceById(id: string): Voice | null
export function parseVoiceId(id: string): { engine: string; nativeId: string }
export function isKnownVoice(id: string): boolean
export function voicesForLanguages(languages?: string[] | null): Voice[]
export function groupVoices(voices?: Voice[]): Array<{ group: string; voices: Voice[] }>
