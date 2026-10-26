import { createReadAloudService } from './service.js'

/**
 * Vite plugin: mounts the read-aloud API on the dev server and on `vite preview`.
 *
 *   import { readAloud } from '@athanor-code/read-aloud/vite'
 *   export default defineConfig({ plugins: [react(), readAloud()] })
 *
 * The plugin owns one service — and therefore one warm model — for the life of
 * the dev server, which is the whole reason a click is fast. It is returned on
 * `plugin.service` so a project that wants to pre-render its own text can.
 */
export function readAloud(options = {}) {
  const service = createReadAloudService({
    onLog: (message) => {
      if (process.env.READ_ALOUD_DEBUG) console.log(`[read-aloud] ${message}`)
    },
    ...options,
  })

  const mount = (server) => {
    server.middlewares.use(service.basePath, (req, res, next) =>
      service.handleRequest(req, res, next),
    )
    // The model process is a child of this one; a dev server restart that left
    // it running would leak 1.5 GB per restart.
    server.httpServer?.once('close', () => service.shutdown())
  }

  return {
    name: 'read-aloud',
    service,
    configureServer: mount,
    configurePreviewServer: mount,
  }
}

export default readAloud
