import { del, get, set } from 'idb-keyval'
import { pdfjs } from 'react-pdf'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DocumentPage } from '@/types/canvas'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PDF_BYTES = 50 * 1024 * 1024
const MAX_TEXT_BYTES = 12 * 1024 * 1024

export interface ImportedDocument {
  fileType: 'pdf' | 'markdown' | 'text'
  text: string
  pages?: DocumentPage[]
  pageCount?: number
  assetId?: string
  needsOcr?: boolean
}

export function detectDocumentType(file: File): 'pdf' | 'markdown' | 'text' | null {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.md') || name.endsWith('.markdown') || file.type === 'text/markdown') {
    return 'markdown'
  }
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'text'
  return null
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pages: DocumentPage[]; pageCount: number }> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const document = await loadingTask.promise
  try {
    const pages: DocumentPage[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        text += item.hasEOL ? '\n' : ' '
      }
      pages.push({ number: pageNumber, text: text.replace(/[ \t]+\n/g, '\n').trim() })
    }

    const meaningfulPages = pages.filter((page) => page.text.trim())
    return {
      text: meaningfulPages.map((page) => `\n\n[Page ${page.number}]\n${page.text}`).join(''),
      pages,
      pageCount: pages.length,
    }
  } finally {
    await loadingTask.destroy()
  }
}

export async function importDocument(file: File, nodeId: string): Promise<ImportedDocument> {
  const fileType = detectDocumentType(file)
  if (!fileType) throw new Error('只支持 PDF、Markdown 或 TXT 文件。')

  if (fileType === 'pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('PDF 超过 50 MB 限制。')
    const buffer = await file.arrayBuffer()
    const assetId = `pdf:${nodeId}`
    await set(assetId, buffer)
    try {
      const extracted = await extractPdf(new Uint8Array(buffer.slice(0)))
      return {
        fileType,
        assetId,
        ...extracted,
        needsOcr: extracted.pages.some((page) => !page.text.trim()),
      }
    } catch (error) {
      await del(assetId)
      throw error
    }
  }

  if (file.size > MAX_TEXT_BYTES) throw new Error('文本文件超过 12 MB 限制。')
  const text = await file.text()
  if (!text.trim()) throw new Error('文件内容为空。')
  return { fileType, text }
}

export async function loadPdfBytes(assetId: string): Promise<Uint8Array | null> {
  const stored = await get<ArrayBuffer>(assetId)
  return stored ? new Uint8Array(stored) : null
}

export async function removePdfAsset(assetId?: string) {
  if (assetId) await del(assetId)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
