import { Buffer } from 'node:buffer'

const MAX_BODY_BYTES = 24 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const OCR_TIMEOUT_MS = 180_000
const OFFICIAL_POLL_RETRY_MS = 5_000

class OcrProxyError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'OcrProxyError'
    this.code = code
    this.status = status
  }
}

function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function sendError(res, error) {
  if (error instanceof OcrProxyError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } })
    return
  }
  sendJson(res, 502, {
    error: {
      code: 'OCR_FAILED',
      message: error instanceof Error ? error.message : 'OCR 请求失败。',
    },
  })
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw new OcrProxyError('BODY_TOO_LARGE', 'OCR 请求体过大。', 413)
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new OcrProxyError('INVALID_JSON', 'OCR 请求不是有效的 JSON。')
  }
}

function getImageBuffer(body) {
  const raw = typeof body.image === 'string' ? body.image.replace(/^data:[^;]+;base64,/, '') : ''
  if (!raw) throw new OcrProxyError('MISSING_IMAGE', '缺少页面图片。')
  let image
  try {
    image = Buffer.from(raw, 'base64')
  } catch {
    throw new OcrProxyError('INVALID_IMAGE', '页面图片编码无效。')
  }
  if (image.length < 64 || image.length > MAX_IMAGE_BYTES) {
    throw new OcrProxyError('INVALID_IMAGE', '页面图片为空或超过 12 MB 限制。')
  }
  return image
}

function getMimeType(body) {
  const value = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : 'image/jpeg'
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(value)) {
    throw new OcrProxyError('INVALID_MIME', '仅支持 JPEG、PNG 或 WebP 页面图片。')
  }
  return value
}

function getToken(body) {
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  return token || process.env.PADDLEOCR_ACCESS_TOKEN?.trim() || ''
}

function getOfficialBaseUrl() {
  return (process.env.PADDLEOCR_BASE_URL?.trim() || 'https://paddleocr.aistudio-app.com').replace(/\/+$/, '')
}

function normalizeSelfHostedEndpoint(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OcrProxyError('MISSING_ENDPOINT', '填写自建 PaddleOCR 服务地址。')
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new OcrProxyError('INVALID_ENDPOINT', '自建服务地址不是有效的 URL。')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new OcrProxyError('INVALID_ENDPOINT', '自建服务地址必须使用 http 或 https。')
  }
  if (url.username || url.password) {
    throw new OcrProxyError('INVALID_ENDPOINT', '不要在服务地址中写入用户名或密码。')
  }
  if (!url.pathname || url.pathname === '/') url.pathname = '/ocr'
  return url.toString().replace(/\/+$/, '')
}

function upstreamMessage(payload, fallback) {
  if (payload && typeof payload === 'object') {
    const value = payload.msg ?? payload.message ?? payload.errorMsg ?? payload.detail
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

async function readUpstreamJson(response, label, signal) {
  if (!response.ok) {
    let payload
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }
    const message = upstreamMessage(payload, `${label}返回 HTTP ${response.status}。`)
    if (response.status === 401 || response.status === 403) {
      throw new OcrProxyError('AUTH_FAILED', `${label}认证失败：${message}`, 401)
    }
    if (response.status === 429) {
      throw new OcrProxyError('RATE_LIMITED', `${label}触发限流：${message}`, 429)
    }
    throw new OcrProxyError('UPSTREAM_ERROR', `${label}请求失败：${message}`, 502)
  }
  try {
    return await response.json()
  } catch {
    throw new OcrProxyError('UPSTREAM_FORMAT', `${label}返回了无法解析的响应。`, 502)
  }
}

function unwrapOfficialPayload(payload, label) {
  if (payload && typeof payload === 'object' && payload.code !== undefined && payload.code !== 0) {
    throw new OcrProxyError(
      'UPSTREAM_ERROR',
      `${label}：${upstreamMessage(payload, `错误码 ${payload.code}`)}`,
      502,
    )
  }
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data
  return payload
}

function normalizeOcrResults(ocrResults) {
  if (!Array.isArray(ocrResults)) {
    throw new OcrProxyError('UPSTREAM_FORMAT', 'OCR 结果缺少 ocrResults。', 502)
  }
  const pages = ocrResults.map((item) => {
    const pruned = item && typeof item === 'object' ? item.prunedResult : undefined
    const texts =
      pruned && Array.isArray(pruned.rec_texts)
        ? pruned.rec_texts.filter((value) => typeof value === 'string' && value.trim())
        : []
    const scores =
      pruned && Array.isArray(pruned.rec_scores)
        ? pruned.rec_scores.filter((value) => typeof value === 'number')
        : []
    return {
      text: texts.join('\n').trim(),
      lines: texts.map((text, index) => ({ text, score: scores[index] })),
    }
  })
  return {
    pages,
    text: pages
      .map((page) => page.text)
      .filter(Boolean)
      .join('\n\n'),
  }
}

function createAbortContext(req, res) {
  const controller = new AbortController()
  const abort = () => {
    if (!res.writableEnded) controller.abort()
  }
  req.on('aborted', abort)
  res.on('close', abort)
  return {
    signal: controller.signal,
    cleanup() {
      req.off('aborted', abort)
      res.off('close', abort)
    },
  }
}

function timeoutSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function waitForPoll(delayMs, signal) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Request aborted', 'AbortError'))
  }
  const { promise, resolve, reject } = Promise.withResolvers()
  const onAbort = () => {
    clearTimeout(timer)
    reject(new DOMException('Request aborted', 'AbortError'))
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, delayMs)
  signal?.addEventListener('abort', onAbort, { once: true })
  return promise
}

async function fetchWithTimeout(url, init, timeoutMs, signal) {
  return fetch(url, {
    ...init,
    redirect: 'manual',
    signal: timeoutSignal(signal, timeoutMs),
  })
}

async function runOfficialOcr({ image, mimeType, model, token, signal }) {
  if (!token) {
    throw new OcrProxyError(
      'MISSING_TOKEN',
      '缺少 AI Studio Access Token。在 OCR 设置中填写，或为服务端配置 PADDLEOCR_ACCESS_TOKEN。',
      401,
    )
  }

  const baseUrl = getOfficialBaseUrl()
  const jobsUrl = `${baseUrl}/api/v2/ocr/jobs`
  const form = new FormData()
  form.append('model', model)
  form.append('optionalPayload', JSON.stringify({ visualize: false }))
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  form.append('file', new Blob([image], { type: mimeType }), `page.${extension}`)

  const submitResponse = await fetchWithTimeout(
    jobsUrl,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
    60_000,
    signal,
  )
  const submitData = unwrapOfficialPayload(
    await readUpstreamJson(submitResponse, 'PaddleOCR 云端任务提交', signal),
    'PaddleOCR 云端任务提交失败',
  )
  if (!submitData || typeof submitData.jobId !== 'string' || !submitData.jobId) {
    throw new OcrProxyError('UPSTREAM_FORMAT', 'PaddleOCR 云端响应缺少 jobId。', 502)
  }

  const deadline = Date.now() + OCR_TIMEOUT_MS
  let delay = 1_000
  let statusData
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    if (signal.aborted) throw new DOMException('Request aborted', 'AbortError')
    await waitForPoll(Math.min(delay, Math.max(0, remaining)), signal)

    const statusResponse = await fetchWithTimeout(
      `${jobsUrl}/${encodeURIComponent(submitData.jobId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      30_000,
      signal,
    )
    statusData = unwrapOfficialPayload(
      await readUpstreamJson(statusResponse, 'PaddleOCR 云端状态查询', signal),
      'PaddleOCR 云端状态查询失败',
    )
    if (statusData?.state === 'done') break
    if (statusData?.state === 'failed') {
      throw new OcrProxyError(
        'JOB_FAILED',
        `PaddleOCR 云端任务失败：${statusData.errorMsg || '未返回错误原因。'}`,
        502,
      )
    }
    delay = Math.min(Math.round(delay * 1.4), OFFICIAL_POLL_RETRY_MS)
  }

  if (statusData?.state !== 'done') {
    throw new OcrProxyError('JOB_TIMEOUT', 'PaddleOCR 云端任务超时，请稍后重试。', 504)
  }
  const resultUrl = statusData?.resultUrl?.jsonUrl
  if (typeof resultUrl !== 'string' || !resultUrl) {
    throw new OcrProxyError('UPSTREAM_FORMAT', 'PaddleOCR 云端任务缺少结果地址。', 502)
  }

  const resultResponse = await fetchWithTimeout(resultUrl, {}, 60_000, signal)
  if (!resultResponse.ok) {
    throw new OcrProxyError('UPSTREAM_ERROR', `读取 PaddleOCR 结果失败：HTTP ${resultResponse.status}。`, 502)
  }
  const jsonl = await resultResponse.text()
  const results = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      throw new OcrProxyError('UPSTREAM_FORMAT', 'PaddleOCR 结果不是有效的 JSONL。', 502)
    }
    if (!Array.isArray(item?.result?.ocrResults)) {
      throw new OcrProxyError('UPSTREAM_FORMAT', 'PaddleOCR 结果缺少 result.ocrResults。', 502)
    }
    results.push(...item.result.ocrResults)
  }
  if (!results.length) {
    throw new OcrProxyError('EMPTY_RESULT', 'PaddleOCR 没有返回 OCR 结果。', 502)
  }

  return {
    provider: 'paddle-cloud',
    model,
    jobId: submitData.jobId,
    ...normalizeOcrResults(results),
  }
}

async function runSelfHostedOcr({ image, token, baseUrl, signal }) {
  const endpoint = normalizeSelfHostedEndpoint(baseUrl)
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: image.toString('base64'), fileType: 1, visualize: false }),
    },
    OCR_TIMEOUT_MS,
    signal,
  )
  const payload = await readUpstreamJson(response, '自建 PaddleOCR 服务', signal)
  if (payload && typeof payload === 'object' && payload.errorCode !== undefined && payload.errorCode !== 0) {
    throw new OcrProxyError(
      'UPSTREAM_ERROR',
      `自建 PaddleOCR 服务返回错误：${upstreamMessage(payload, String(payload.errorCode))}`,
      502,
    )
  }
  const results =
    payload?.result?.ocrResults ??
    payload?.ocrResults
  const normalized = normalizeOcrResults(results)
  return {
    provider: 'self-hosted',
    ...normalized,
  }
}

export async function handleOcrRequest(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST。' } })
    return
  }

  const contentType = String(req.headers['content-type'] || '')
  if (!contentType.toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, {
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'OCR 请求必须使用 application/json。' },
    })
    return
  }

  const abortContext = createAbortContext(req, res)
  try {
    const body = await readJson(req)
    const provider = body?.provider === 'self-hosted' ? 'self-hosted' : 'paddle-cloud'
    const image = getImageBuffer(body)
    const mimeType = getMimeType(body)
    const token = getToken(body)
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'PP-OCRv6'
    const result =
      provider === 'self-hosted'
        ? await runSelfHostedOcr({ image, token, baseUrl: body.baseUrl, signal: abortContext.signal })
        : await runOfficialOcr({ image, mimeType, model, token, signal: abortContext.signal })
    sendJson(res, 200, result)
  } catch (error) {
    if (res.destroyed) return
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      sendJson(res, 504, {
        error: { code: 'TIMEOUT', message: 'OCR 请求超时或已取消。' },
      })
      return
    }
    sendError(res, error)
  } finally {
    abortContext.cleanup()
  }
}

export function handleOcrHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    serverTokenConfigured: Boolean(process.env.PADDLEOCR_ACCESS_TOKEN?.trim()),
  })
}
