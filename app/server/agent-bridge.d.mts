import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleAgentStatus(req: IncomingMessage, res: ServerResponse): void
export function handleAgentProbe(req: IncomingMessage, res: ServerResponse): Promise<void>
