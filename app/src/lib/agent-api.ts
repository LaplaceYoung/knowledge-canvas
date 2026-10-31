export interface AgentStatus {
  configured: boolean
  command: string | null
  argsCount: number
  cwd: string
  cwdExists: boolean
  protocol: string
  timeoutMs: number
}

export interface AgentProbe {
  protocolVersion: number
  agent: {
    name?: string
    title?: string
    version?: string
  } | null
  authMethods: Array<{ type: string; name?: string }>
  capabilities: {
    loadSession?: boolean
    imagePrompt?: boolean
    audioPrompt?: boolean
    embeddedContext?: boolean
    sessionResume?: boolean
    sessionClose?: boolean
  }
  sessionCreated: boolean
  sessionError?: string
}

export class AgentApiError extends Error {
  code: string

  constructor(message: string, code = 'AGENT_API_ERROR') {
    super(message)
    this.name = 'AgentApiError'
    this.code = code
  }
}

async function parseError(response: Response): Promise<AgentApiError> {
  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string } }
    return new AgentApiError(
      payload.error?.message || `Agent 请求失败（HTTP ${response.status}）。`,
      payload.error?.code || 'AGENT_API_ERROR',
    )
  } catch {
    return new AgentApiError(`Agent 请求失败（HTTP ${response.status}）。`)
  }
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const response = await fetch('/api/agent/status')
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as AgentStatus
}

export async function probeAgent(): Promise<AgentProbe> {
  const response = await fetch('/api/agent/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as AgentProbe
}
