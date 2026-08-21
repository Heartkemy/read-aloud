/**
 * Server entry point — Node only.
 *
 * Kept separate from the React entry (`@athanor-code/read-aloud`) so importing
 * a button into a component never drags `node:child_process` into a browser
 * bundle.
 */
export { createReadAloudService, CACHE_VERSION, wavSeconds } from './service.js'
export { createKokoroEngine, createSynthesizer, resolvePython, DEFAULT_VENV, DEFAULT_SCRIPT } from './engines/kokoro.js'
export { createSayEngine, parseVoiceList } from './engines/say.js'
export { createNormalizer } from './normalizer.js'
export { readAloud as readAloudVitePlugin } from './vite.js'
export { readAloudRouter } from './express.js'
export { createReadAloudFetchHandler } from './fetch.js'
export * from '../voices.js'
export * from '../text.js'
