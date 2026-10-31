import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleChatRequest(req: IncomingMessage, res: ServerResponse): Promise<void>
