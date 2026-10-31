import { createPdfOcrRenderer, type PdfOcrRenderer } from '@/lib/pdf-ocr'
import { requestPageOcr, OcrRequestError } from '@/lib/ocr-api'
import { getOcrToken } from '@/lib/ocr-token'
import { useCanvasStore } from '@/store/canvas-store'
import type { DocumentNodeData } from '@/types/canvas'
import { loadPdfBytes } from '@/lib/files'

const controllers = new Map<string, AbortController>()

const FATAL_CODES: Record<string, true> = {
  AUTH_FAILED: true,
  MISSING_TOKEN: true,
  MISSING_ENDPOINT: true,
  INVALID_ENDPOINT: true,
  PROXY_UNREACHABLE: true,
}

export function getOcrTargetPages(data: DocumentNodeData): number[] {
  if (data.fileType !== 'pdf' || !data.pageCount) return []
  const embedded = new Map((data.pages ?? []).map((page) => [page.number, page.text.trim()]))
  const ocr = new Map((data.ocrPages ?? []).map((page) => [page.number, page.status]))
  return Array.from({ length: data.pageCount }, (_, index) => index + 1).filter(
    (page) => !embedded.get(page) && ocr.get(page) !== 'done',
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'OCR 请求失败，请稍后重试。'
}

function markRemaining(id: string, message: string) {
  const store = useCanvasStore.getState()
  const node = store.nodes.find((entry) => entry.id === id)
  if (!node || node.data.kind !== 'document') return
  for (const page of node.data.ocrPages ?? []) {
    if (page.status === 'pending' || page.status === 'processing') {
      store.updateOcrPage(id, page.number, { status: 'error', error: message })
    }
  }
}

export async function runDocumentOcr(nodeId: string, requestedPages?: number[]) {
  if (controllers.has(nodeId)) return
  const store = useCanvasStore.getState()
  const node = store.nodes.find((entry) => entry.id === nodeId)
  if (!node || node.data.kind !== 'document' || node.data.status !== 'ready') return

  const pageCount = node.data.pageCount ?? 0
  const targets = (requestedPages ?? getOcrTargetPages(node.data)).filter(
    (page) => Number.isInteger(page) && page > 0 && page <= pageCount,
  )
  if (!targets.length) return

  const config = store.ocrConfig
  if (config.provider === 'self-hosted' && !config.endpoint.trim()) {
    store.finishOcrRun(nodeId, '先配置自建 PaddleOCR 服务地址。')
    store.openSettings('ocr')
    return
  }

  const controller = new AbortController()
  controllers.set(nodeId, controller)
  store.beginOcrRun(nodeId, targets, config.model)
  let fatalError: string | undefined
  let renderer: PdfOcrRenderer | undefined

  try {
    if (!node.data.assetId) throw new Error('本地 PDF 文件已丢失，请重新导入。')
    const bytes = await loadPdfBytes(node.data.assetId)
    if (!bytes) throw new Error('本地 PDF 文件已丢失，请重新导入。')
    renderer = await createPdfOcrRenderer(bytes)

    for (const pageNumber of targets) {
      if (controller.signal.aborted) break
      useCanvasStore.getState().updateOcrPage(nodeId, pageNumber, {
        status: 'processing',
        error: undefined,
      })
      try {
        const image = await renderer.render(pageNumber, controller.signal)
        const result = await requestPageOcr(
          {
            provider: config.provider,
            imageBase64: image.base64,
            mimeType: image.mimeType,
            model: config.model,
            endpoint: config.endpoint,
            token: getOcrToken(config.provider),
          },
          controller.signal,
        )
        useCanvasStore.getState().updateOcrPage(nodeId, pageNumber, {
          status: 'done',
          text: result.text,
          error: undefined,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') break
        const message = errorMessage(error)
        useCanvasStore.getState().updateOcrPage(nodeId, pageNumber, {
          status: 'error',
          error: message,
        })
        if (error instanceof OcrRequestError && FATAL_CODES[error.code]) {
          fatalError = message
          break
        }
      }
    }

    if (controller.signal.aborted) {
      markRemaining(nodeId, '已停止')
    } else if (fatalError) {
      markRemaining(nodeId, fatalError)
    }
    useCanvasStore.getState().finishOcrRun(nodeId, fatalError)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      fatalError = errorMessage(error)
      markRemaining(nodeId, fatalError)
    }
    useCanvasStore.getState().finishOcrRun(nodeId, fatalError)
  } finally {
    controllers.delete(nodeId)
    if (renderer) await renderer.destroy().catch(() => undefined)
  }
}

export function cancelDocumentOcr(nodeId: string) {
  controllers.get(nodeId)?.abort()
}
