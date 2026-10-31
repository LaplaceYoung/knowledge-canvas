export type ApiRole = 'system' | 'user' | 'assistant'

export interface ApiMessage {
  role: ApiRole
  content: string
}

export interface StreamChatOptions {
  baseUrl: string
  model: string
  apiKey: string
  messages: ApiMessage[]
  signal: AbortSignal
  onDelta: (delta: string) => void
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
  error?: { message?: string }
}

function extractDelta(chunk: StreamChunk): string {
  const content = chunk.choices?.[0]?.delta?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('')
  }
  return ''
}

async function readError(response: Response): Promise<string> {
  const raw = await response.text()
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch {
    // Keep the raw upstream text when the gateway does not return JSON.
  }
  return raw.slice(0, 500) || `请求失败（HTTP ${response.status}）`
}

export async function streamChatCompletion({
  baseUrl,
  model,
  apiKey,
  messages,
  signal,
  onDelta,
}: StreamChatOptions): Promise<void> {
  if (!baseUrl.trim()) throw new Error('缺少 API Base URL。')
  if (!model.trim()) throw new Error('缺少模型名称。')

  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim(),
        messages,
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(
      '无法连接本地模型代理。请确认 Vite 开发服务或 server.mjs 正在运行，然后重试。',
    )
  }

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  if (!response.body) {
    throw new Error('模型接口没有返回可读取的流。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = false

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return

    let chunk: StreamChunk
    try {
      chunk = JSON.parse(payload) as StreamChunk
    } catch {
      return
    }
    if (chunk.error?.message) throw new Error(chunk.error.message)
    const delta = extractDelta(chunk)
    if (delta) {
      emitted = true
      onDelta(delta)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) processLine(line)
  }

  buffer += decoder.decode()
  if (buffer.trim()) processLine(buffer)

  if (!emitted) {
    throw new Error('接口已返回，但没有收到文本内容。请确认该接口支持 OpenAI-compatible SSE 流式格式。')
  }
}
