/**
 * Types for the Node entry points: `@athanor-code/read-aloud/server`, `/vite`,
 * `/express` and `/fetch`.
 *
 * Hand-written, like the React ones. The package is plain JavaScript, and a
 * declaration file that says exactly what the public API is beats a build step
 * that emits `any` in the interesting places.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Voice } from './index.js'

export interface EngineInfo {
  id: string
  label: string
  available: boolean
  reason: string | null
}

export interface ServiceInfo {
  /** False when no engine on this machine can speak — the buttons hide themselves. */
  available: boolean
  basePath: string
  defaultVoice: string | null
  voices: Voice[]
  engines: EngineInfo[]
  reason: string | null
}

export interface SpeechClip {
  /** Relative URL under `basePath`, served with HTTP range support. */
  url: string
  /** Real duration in seconds, read from the rendered file. */
  seconds: number
  voice: string
  cached: boolean
}

export interface SynthesizeInput {
  text: string
  /** Spoken-only lead-in, prepended before `text`. Part of the cache key. */
  intro?: string
  /** Engine-qualified voice id. Falls back to the service default. */
  voice?: string
  /** Heavier pause-widening (CALM_PAUSE) for dense, information-heavy text.
   *  Part of the cache key, so calm and normal reads cache separately. */
  calm?: boolean
  /** Exact seconds of pause-widening, overriding `calm`. Part of the cache key. */
  breathe?: number
}

/** One engine — implement this to add Piper, espeak-ng, or a cloud provider. */
export interface Engine {
  id: string
  label: string
  available(): boolean
  unavailableReason?(): string | null
  voices(): Voice[] | Promise<Voice[]>
  render(input: {
    text: string
    out: string
    voice: string
    speed?: number
    /** Seconds of pause-widening. Ignored by engines that can't widen pauses. */
    pause?: number
  }): Promise<unknown>
  stop?(): void
  readonly warm?: boolean
}

export interface ReadAloudOptions {
  /** URL the API is mounted at; clip URLs are built from it. Default `/api/read-aloud`. */
  basePath?: string
  /** Where rendered clips live. Defaults to `node_modules/.cache/read-aloud`. */
  cacheDir?: string
  /** Engine-qualified id, e.g. `say:Karen`. Default `kokoro:bm_george`. */
  defaultVoice?: string
  /** Catalogue languages to offer. `null` for all. Default `['en']`. */
  languages?: string[] | null
  /** Disk cap; oldest clips evicted first. Default 200. */
  maxCachedClips?: number
  /** Hard limit on one passage, in characters. Default 20000. */
  maxTextLength?: number
  /** How long the neural model stays warm before being released, measured from
   *  the last render or the last `keepWarm()`. Default 10 min. */
  idleTimeoutMs?: number
  /** Start loading the model when a page asks for the voice list, rather than
   *  on the first click. Default true. */
  warmOnLoad?: boolean
  /** Python with mlx-audio installed. Default `$READ_ALOUD_PYTHON`, then the shared venv. */
  pythonPath?: string
  scriptPath?: string
  model?: string
  /** Pause-widening applied to a normal read. Default 0.25 (see python/breathe.py). */
  defaultPause?: number
  /** Pause-widening applied when a request sets `calm: true`. Default 0.6. */
  calmPause?: number
  /** Replace the engine list entirely. */
  engines?: Engine[]
  onLog?: (message: string) => void
}

export interface ReadAloudService {
  basePath: string
  cacheDir: string
  info(): Promise<ServiceInfo>
  /** "Still listening" — restarts the idle countdown on an already-loaded
   *  model. Never starts one. The client sends this when a passage ends. */
  keepWarm(): { warm: boolean }
  synthesize(input: SynthesizeInput): Promise<SpeechClip>
  /** Best-effort pre-render for text a user is likely to press play on. Never throws. */
  warm(passages: string | SynthesizeInput | Array<string | SynthesizeInput>): Promise<void>
  handleRequest(req: IncomingMessage, res: ServerResponse, next?: () => void): Promise<unknown>
  /** Releases the model process. Call on server shutdown. */
  shutdown(): void
  engines: Engine[]
}

export function createReadAloudService(options?: ReadAloudOptions): ReadAloudService

/** Duration of a PCM WAV, by walking its chunks rather than trusting offset 40. */
export function wavSeconds(filePath: string): number

export const CACHE_VERSION: number
export const DEFAULT_PAUSE: number
export const CALM_PAUSE: number

export function createKokoroEngine(options?: ReadAloudOptions & { languages?: string[] | null }): Engine
export function createSayEngine(options?: { languages?: string[] | null; includeNovelty?: boolean }): Engine
export function createNormalizer(options?: { pythonPath?: string; idleTimeoutMs?: number; onLog?: (m: string) => void }): {
  available(): boolean
  normalize(text: string, options?: { readCode?: boolean }): Promise<{ text: string; leaks: string[] }>
  stop(): void
  pythonPath: string | null
}
export function parseVoiceList(stdout: string): Voice[]
export function resolvePython(explicit?: string): string | null
export const DEFAULT_VENV: string
export const DEFAULT_SCRIPT: string

/** Vite plugin. `plugin.service` is the live service, for warming. */
export function readAloudVitePlugin(options?: ReadAloudOptions): {
  name: string
  service: ReadAloudService
  configureServer(server: unknown): void
  configurePreviewServer(server: unknown): void
}

/** Express/Connect middleware. Mount before any body parser. */
export function readAloudRouter(options?: ReadAloudOptions): ((
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => unknown) & { service: ReadAloudService; basePath: string; shutdown(): void }

/** Web-standard handler for Next route handlers, Hono, Bun, Deno. */
export function createReadAloudFetchHandler(
  options?: ReadAloudOptions & { service?: ReadAloudService },
): {
  handle(request: Request): Promise<Response>
  GET(request: Request): Promise<Response>
  POST(request: Request): Promise<Response>
  service: ReadAloudService
}

export * from './index.js'
