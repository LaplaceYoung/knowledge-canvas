import { Buffer } from 'node:buffer'
import { Readable, pipeline } from 'node:stream'

const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_STREAM_TIME_MS = 10 * 60 * 1000

class ChatProxyError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ChatProxyError'
    this.code = code
    this.status = status
  }
}

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw new ChatProxyError('BODY_TOO_LARGE', '模型请求体过大。', 413)
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ChatProxyError('INVALID_JSON', '模型请求不是有效的 JSON。')
  }
}

function normalizeEndpoint(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ChatProxyError('MISSING_BASE_URL', '缺少模型 API Base URL。')
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new ChatProxyError(
      'INVALID_BASE_URL',
      'Base URL 不是有效的地址。请填写完整的 http(s) 地址，例如 https://api.openai.com/v1。',
    )
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ChatProxyError('INVALID_BASE_URL', 'Base URL 必须使用 http 或 https。')
  }
  if (url.username || url.password) {
    throw new ChatProxyError('INVALID_BASE_URL', '不要在 Base URL 中写入账号或密码。')
  }
  url.hash = ''
  const path = url.pathname.replace(/\/+$/, '')
  if (!/\/chat\/completions$/i.test(path)) {
    url.pathname = `${path}/chat/completions`.replace(/\/{2,}/g, '/')
  }
  return url.toString()
}

function normalizeMessages(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ChatProxyError('MISSING_MESSAGES', '模型请求缺少消息内容。')
  }
  return value.map((message) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string'
    ) {
      throw new ChatProxyError('INVALID_MESSAGES', '模型消息格式无效。')
    }
    return { role: message.role, content: message.content }
  })
}

function upstreamDetail(raw) {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const message = parsed?.error?.message ?? parsed?.message ?? parsed?.error
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500)
  } catch {
    // Non-JSON upstream errors are common for gateways and HTML error pages.
  }
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function translateUpstreamError(status, raw) {
  const detail = upstreamDetail(raw)
  const suffix = detail ? ` 服务返回：${detail}` : ''
  if (status === 401 || status === 403) {
    return new ChatProxyError(
      'AUTH_FAILED',
      `模型服务认证失败（HTTP ${status}）。请检查 API Key 是否有效、是否属于当前 Base URL。${suffix}`,
      401,
    )
  }
  if (status === 404) {
    return new ChatProxyError(
      'ENDPOINT_NOT_FOUND',
      `找不到模型接口（HTTP 404）。检查 Base URL 是否包含正确的版本路径，例如 https://api.openai.com/v1。${suffix}`,
      404,
    )
  }
  if (status === 429) {
    return new ChatProxyError('RATE_LIMITED', `模型服务限流或额度不足（HTTP 429）。${suffix}`, 429)
  }
  if (status >= 500) {
    return new ChatProxyError(
      'UPSTREAM_UNAVAILABLE',
      `模型服务暂时不可用（HTTP ${status}）。${suffix}`,
      502,
    )
  }
  return new ChatProxyError(
    'UPSTREAM_REJECTED',
    `模型服务拒绝了请求（HTTP ${status}）。检查模型名称和请求参数。${suffix}`,
    400,
  )
}

export async function handleChatRequest(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST。' } })
    return
  }
  const contentType = String(req.headers['content-type'] || '')
  if (!contentType.toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, {
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '模型请求必须使用 application/json。' },
    })
    return
  }

  const controller = new AbortController()
  let streamClosed = false
  const abort = () => {
    if (!streamClosed) controller.abort()
  }
  req.on('aborted', abort)
  res.on('close', abort)

  try {
    const body = await readJson(req)
    const endpoint = normalizeEndpoint(body.baseUrl)
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) throw new ChatProxyError('MISSING_MODEL', '缺少模型名称。')
    const messages = normalizeMessages(body.messages)
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const endpointUrl = new URL(endpoint)
    if (endpointUrl.hostname === 'openrouter.ai') {
      headers['HTTP-Referer'] = 'http://localhost'
      headers['X-Title'] = 'Knowledge Canvas'
    }

    let upstream
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, stream: true }),
        redirect: 'manual',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MAX_STREAM_TIME_MS)]),
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DOMException('Request aborted', 'AbortError')
      }
      if (error?.name === 'TimeoutError') {
        throw new ChatProxyError('MODEL_TIMEOUT', '模型请求超时。', 504)
      }
      throw new ChatProxyError(
        'NETWORK_ERROR',
        `无法连接到模型服务。检查 Base URL 和网络连接。${error instanceof Error ? ` ${error.message}` : ''}`,
        502,
      )
    }

    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => '')
      throw translateUpstreamError(upstream.status, raw)
    }
    if (!upstream.body) {
      throw new ChatProxyError('EMPTY_STREAM', '模型服务没有返回可读取的流。', 502)
    }

    res.statusCode = 200
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    streamClosed = true
    const stream = Readable.fromWeb(upstream.body)
    pipeline(stream, res, (error) => {
      if (error && !res.destroyed) res.destroy()
    })
  } catch (error) {
    if (res.destroyed) return
    if (error?.name === 'AbortError') {
      if (!res.headersSent) {
        sendJson(res, 499, { error: { code: 'REQUEST_ABORTED', message: '模型请求已取消。' } })
      }
      return
    }
    if (error instanceof ChatProxyError) {
      sendJson(res, error.status, { error: { code: error.code, message: error.message } })
      return
    }
    sendJson(res, 502, {
      error: {
        code: 'MODEL_PROXY_FAILED',
        message: error instanceof Error ? error.message : '模型代理请求失败。',
      },
    })
  } finally {
    req.off('aborted', abort)
    res.off('close', abort)
  }
}
