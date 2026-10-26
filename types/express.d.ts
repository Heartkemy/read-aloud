import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ReadAloudOptions, ReadAloudService } from './server.js'

export type ReadAloudRouter = ((
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => unknown) & { service: ReadAloudService; basePath: string; shutdown(): void }

export function readAloudRouter(options?: ReadAloudOptions): ReadAloudRouter
export default readAloudRouter
