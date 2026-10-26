import { createReadAloudService } from './service.js'

/**
 * Express adapter.
 *
 *   import { readAloudRouter } from '@athanor-code/read-aloud/express'
 *   const readAloud = readAloudRouter({ basePath: '/api/read-aloud' })
 *   app.use(readAloud.basePath, readAloud)
 *
 * A bare middleware function rather than an `express.Router()`, so this module
 * imports nothing: it works the same under Express 4, Express 5, Connect, or a
 * plain `http.createServer`. The service hangs off `.service` for warming, and
 * `.basePath` off the middleware so the mount point can't drift from the URLs
 * the service hands out.
 *
 * Mount it *before* any body parser, or mount it with the parser skipped for
 * this path: the handler reads the request stream itself.
 */
export function readAloudRouter(options = {}) {
  const service = createReadAloudService({
    onLog: (message) => {
      if (process.env.READ_ALOUD_DEBUG) console.log(`[read-aloud] ${message}`)
    },
    ...options,
  })

  const middleware = (req, res, next) => service.handleRequest(req, res, next)
  middleware.service = service
  middleware.basePath = service.basePath
  middleware.shutdown = service.shutdown
  return middleware
}

export default readAloudRouter
