import type { OcrProvider } from '@/types/canvas'

export interface OcrPageRequest {
  provider: OcrProvider
  imageBase64: string
  mimeType: string
  model: string
  endpoint: string
  token: string
}

export interface OcrPageResult {
  text: string
  provider: OcrProvider
  model?: string
  jobId?: string
}

export class OcrRequestError extends Error {
  code: string
  status: number

  constructor(message: string, code = 'OCR_FAILED', status = 0) {
    super(message)
    this.name = 'OcrRequestError'
    this.code = code
    this.status = status
  }
}

export async function requestPageOcr(
  request: OcrPageRequest,
  signal?: AbortSignal,
): Promise<OcrPageResult> {
  let response: Response
  try {
    response = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: request.provider,
        image: request.imageBase64,
        mimeType: request.mimeType,
        model: request.model,
        baseUrl: request.endpoint,
        token: request.token,
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new OcrRequestError(
      '无法连接 OCR 代理。请确认开发服务或 server.mjs 正在运行。',
      'PROXY_UNREACHABLE',
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    const error = payload as { error?: { code?: unknown; message?: unknown } } | undefined
    const message =
      typeof error?.error?.message === 'string'
        ? error.error.message
        : `OCR 请求失败（HTTP ${response.status}）。`
    const code = typeof error?.error?.code === 'string' ? error.error.code : 'OCR_FAILED'
    throw new OcrRequestError(message, code, response.status)
  }

  const result = payload as Partial<OcrPageResult> | undefined
  if (!result || typeof result.text !== 'string') {
    throw new OcrRequestError('OCR 代理返回了无法识别的结果。', 'INVALID_RESULT', 502)
  }
  return {
    text: result.text,
    provider: request.provider,
    model: result.model,
    jobId: result.jobId,
  }
}
