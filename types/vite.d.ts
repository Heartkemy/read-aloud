import type { ReadAloudOptions, ReadAloudService } from './server.js'

export interface ReadAloudVitePlugin {
  name: string
  service: ReadAloudService
  configureServer(server: unknown): void
  configurePreviewServer(server: unknown): void
}

export function readAloud(options?: ReadAloudOptions): ReadAloudVitePlugin
export default readAloud
