import type { ReadAloudOptions, ReadAloudService } from './server.js'

export interface ReadAloudFetchHandler {
  handle(request: Request): Promise<Response>
  GET(request: Request): Promise<Response>
  POST(request: Request): Promise<Response>
  OPTIONS(request: Request): Promise<Response>
  service: ReadAloudService
}

export function createReadAloudFetchHandler(
  options?: ReadAloudOptions & { service?: ReadAloudService },
): ReadAloudFetchHandler
export default createReadAloudFetchHandler
