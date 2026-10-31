import * as pdfjsLib from 'pdfjs-dist'
import '@/lib/pdf'

export interface RenderedOcrPage {
  base64: string
  mimeType: 'image/jpeg'
}

export interface PdfOcrRenderer {
  render: (pageNumber: number, signal?: AbortSignal) => Promise<RenderedOcrPage>
  destroy: () => Promise<void>
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function createPdfOcrRenderer(bytes: Uint8Array): Promise<PdfOcrRenderer> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const document = await loadingTask.promise

  return {
    async render(pageNumber, signal) {
      signal?.throwIfAborted()
      const page = await document.getPage(pageNumber)
      try {
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(2.6, 1800 / Math.max(base.width, base.height))
        const viewport = page.getViewport({ scale })
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('无法创建 PDF 页面画布。')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)

        await page.render({ canvas, canvasContext: context, viewport }).promise
        signal?.throwIfAborted()

        const { promise, resolve } = Promise.withResolvers<Blob | null>()
        canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.88)
        const blob = await promise
        if (!blob) throw new Error('无法生成 PDF 页面图片。')
        const base64 = encodeBase64(await blob.arrayBuffer())
        canvas.width = 1
        canvas.height = 1
        return { base64, mimeType: 'image/jpeg' }
      } finally {
        page.cleanup()
      }
    },
    async destroy() {
      await loadingTask.destroy()
    },
  }
}
