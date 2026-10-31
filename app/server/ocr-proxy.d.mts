import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleOcrRequest(req: IncomingMessage, res: ServerResponse): Promise<void>
export function handleOcrHealth(req: IncomingMessage, res: ServerResponse): void
