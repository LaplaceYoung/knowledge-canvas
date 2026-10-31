import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  ScanText,
  Settings2,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { Document as PdfDocument, Page } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import '@/lib/pdf'
import { NodeShell } from '@/components/NodeShell'
import { Markdown } from '@/components/Markdown'
import { SelectionPopover } from '@/components/SelectionPopover'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { highlightQuote, useSelectionTool, type SelectionPayload } from '@/hooks/use-selection-tool'
import { loadPdfBytes } from '@/lib/files'
import { cancelDocumentOcr, getOcrTargetPages, runDocumentOcr } from '@/lib/ocr-runner'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasNode, DocumentNodeData } from '@/types/canvas'
import { NODE_SIZES } from '@/types/canvas'

function useContainerWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(520)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 80) setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}

interface DocumentBodyProps {
  node: CanvasNode & { data: DocumentNodeData }
  mode: 'canvas' | 'focus'
}

export function DocumentBody({ node, mode }: DocumentBodyProps) {
  const data = node.data
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [pdfError, setPdfError] = useState<string>()
  const documentRef = useRef<HTMLDivElement>(null)
  const pdfSurfaceRef = useRef<HTMLDivElement>(null)
  const pageWidth = useContainerWidth(pdfSurfaceRef)
  const setDocumentPage = useCanvasStore((state) => state.setDocumentPage)
  const setDocumentView = useCanvasStore((state) => state.setDocumentView)
  const createBranch = useCanvasStore((state) => state.createBranch)
  const sourceJump = useCanvasStore((state) => state.sourceJump)
  const openSettings = useCanvasStore((state) => state.openSettings)

  useEffect(() => {
    if (data.fileType !== 'pdf' || !data.assetId) return
    let cancelled = false
    loadPdfBytes(data.assetId)
      .then((bytes) => {
        if (cancelled) return
        if (!bytes) setPdfError('本地 PDF 文件已丢失，请重新导入。')
        else setPdfBytes(bytes)
      })
      .catch(() => {
        if (!cancelled) setPdfError('无法读取本地 PDF 文件。')
      })
    return () => {
      cancelled = true
    }
  }, [data.assetId, data.fileType])

  useEffect(() => {
    if (mode !== 'focus' || sourceJump?.nodeId !== node.id) return
    if (sourceJump.view === 'ocr' && (data.ocrPages?.length ?? 0) > 0) {
      setDocumentView(node.id, 'ocr')
    } else if (sourceJump.view === 'page') {
      setDocumentView(node.id, 'page')
    }
    if (sourceJump.page) setDocumentPage(node.id, sourceJump.page)
    const timer = window.setTimeout(() => {
      if (sourceJump.quote) highlightQuote(documentRef.current, sourceJump.quote)
    }, 320)
    return () => window.clearTimeout(timer)
  }, [
    mode,
    node.id,
    sourceJump?.nonce,
    sourceJump?.nodeId,
    sourceJump?.page,
    sourceJump?.quote,
    sourceJump?.view,
    data.currentPage,
    data.ocrPages?.length,
    setDocumentPage,
    setDocumentView,
  ])

  const getSource = useCallback((range: Range): SelectionPayload | null => {
    const common = range.commonAncestorContainer
    const element = common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement
    const ocrPage = element?.closest<HTMLElement>('[data-ocr-page]')
    if (ocrPage) {
      return {
        quote: range.toString().trim(),
        page: Number(ocrPage.dataset.ocrPage),
        view: 'ocr',
      }
    }
    const pageElement = element?.closest<HTMLElement>('[data-pdf-page]')
    return {
      quote: range.toString().trim(),
      page: pageElement ? Number(pageElement.dataset.pdfPage) : undefined,
      view: pageElement ? 'page' : undefined,
    }
  }, [])

  const { pending, handleMouseUp, close } = useSelectionTool({
    containerRef: documentRef,
    getSource,
  })

  const loading = data.status === 'loading'
  const failed = data.status === 'error' || Boolean(pdfError)
  const ocrPages = data.ocrPages ?? []
  const ocrRunning = data.ocrStatus === 'running'
  const ocrDone = ocrPages.filter((page) => page.status === 'done').length
  const ocrFailed = ocrPages.filter((page) => page.status === 'error').length
  const targetPages = getOcrTargetPages(data)
  const showOcr = data.fileType === 'pdf' && data.viewMode === 'ocr' && ocrPages.length > 0
  const hasOcrText = ocrPages.some((page) => page.status === 'done' && page.text.trim())
  const hasEmbeddedText = Boolean(data.pages?.some((page) => page.text.trim()))
  const showOcrBanner =
    data.fileType === 'pdf' &&
    data.status === 'ready' &&
    !hasEmbeddedText &&
    !hasOcrText &&
    !ocrRunning &&
    !showOcr &&
    !failed

  const runOcr = useCallback(
    async (pages?: number[]) => {
      try {
        await runDocumentOcr(node.id, pages)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'OCR 启动失败。')
      }
    },
    [node.id],
  )

  return (
    <div className="document-body flex min-h-0 flex-1 flex-col">
      <div className="document-toolbar flex h-9 flex-none items-center justify-between gap-2 border-b px-2">
        {data.fileType === 'pdf' ? (
          <>
            {showOcr ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                识别文本 · {ocrDone}/{ocrPages.length} 页
              </span>
            ) : (
              <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一页"
                  disabled={data.currentPage <= 1}
                  onClick={() => setDocumentPage(node.id, data.currentPage - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="min-w-14 text-center tabular-nums">
                  {data.currentPage} / {data.pageCount ?? '—'}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一页"
                  disabled={!data.pageCount || data.currentPage >= data.pageCount}
                  onClick={() => setDocumentPage(node.id, data.currentPage + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
            <div className="flex shrink-0 items-center gap-0.5">
              {ocrPages.length > 0 && (
                <div className="flex items-center rounded-md border bg-muted/50 p-0.5">
                  <Button
                    type="button"
                    variant={showOcr ? 'ghost' : 'secondary'}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    aria-pressed={!showOcr}
                    onClick={() => setDocumentView(node.id, 'page')}
                  >
                    页面
                  </Button>
                  <Button
                    type="button"
                    variant={showOcr ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    aria-pressed={showOcr}
                    onClick={() => setDocumentView(node.id, 'ocr')}
                  >
                    识别文本
                  </Button>
                </div>
              )}
              {!ocrRunning && targetPages.length > 0 && !showOcr && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void runOcr()}
                >
                  <ScanText className="size-3.5" />
                  OCR
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {data.fileType === 'markdown' ? 'Markdown' : '纯文本'}
            </span>
            <span className="text-xs text-muted-foreground">{data.text.length.toLocaleString()} 字</span>
          </>
        )}
      </div>

      {(ocrRunning || ocrFailed > 0 || Boolean(data.ocrError)) && data.fileType === 'pdf' && (
        <div className="ocr-status-strip">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {ocrRunning && <span className="ocr-live-dot" aria-hidden="true" />}
            <span className="truncate">
              {ocrRunning
                ? `正在识别 ${ocrDone}/${ocrPages.length} 页`
                : data.ocrError || `${ocrFailed} 页需要重试`}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {ocrRunning ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => cancelDocumentOcr(node.id)}
              >
                <Square className="size-3 fill-current" />
                停止
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => void runOcr(targetPages)}
              >
                <RefreshCw className="size-3" />
                重试
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => openSettings('ocr')}
            >
              <Settings2 className="size-3" />
              设置
            </Button>
          </div>
        </div>
      )}

      <div
        className="document-scroll nowheel min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/40"
        ref={documentRef}
        onMouseUp={handleMouseUp}
      >
        {loading && (
          <div className="space-y-3 p-5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
            <p className="pt-2 text-xs text-muted-foreground">正在解析文档</p>
          </div>
        )}

        {failed && (
          <div className="flex flex-col items-start gap-2 p-5">
            <FileWarning className="size-5 text-destructive" />
            <p className="text-sm text-destructive">{data.error || pdfError || '文档无法读取。'}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              删除后重新导入；扫描 PDF 可配置 PaddleOCR 后识别。
            </p>
          </div>
        )}

        {showOcrBanner && (
          <div className="ocr-empty-banner">
            <ScanText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-[13px] leading-6">这个 PDF 没有可提取的文本层。</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                运行 PaddleOCR 后，识别结果会按页保存，可直接选中文字追问。
              </p>
              {data.ocrError && <p className="mt-1 text-xs leading-5 text-destructive">{data.ocrError}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button type="button" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void runOcr()}>
                  <ScanText className="size-3.5" />
                  运行 OCR
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={() => openSettings('ocr')}
                >
                  <Settings2 className="size-3.5" />
                  OCR 设置
                </Button>
              </div>
            </div>
          </div>
        )}

        {!loading && !failed && data.fileType === 'pdf' && showOcr && (
          <div className="ocr-document">
            <div className="ocr-document-head">
              <span>页面文字由 PaddleOCR 识别</span>
              <span className="tabular-nums">
                {ocrDone}/{ocrPages.length} 页
              </span>
            </div>
            {ocrPages.map((page) => (
              <section key={page.number} className="ocr-page" data-ocr-page={page.number}>
                <div className="ocr-page-head">
                  <span>第 {page.number} 页</span>
                  <span className="text-border" aria-hidden="true">
                    /
                  </span>
                  <span>OCR</span>
                  {page.status === 'processing' && <LoaderCircle className="size-3 animate-spin" />}
                </div>
                {page.status === 'done' ? (
                  page.text ? (
                    <div className="ocr-page-text">{page.text}</div>
                  ) : (
                    <p className="ocr-page-muted">这一页没有识别到文字。</p>
                  )
                ) : page.status === 'error' ? (
                  <div className="ocr-page-error">
                    <p>{page.error || '识别失败。'}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-xs"
                      onClick={() => void runOcr([page.number])}
                    >
                      重试本页
                    </Button>
                  </div>
                ) : (
                  <p className="ocr-page-muted">
                    {page.status === 'processing' ? '正在识别这一页' : '等待识别'}
                  </p>
                )}
              </section>
            ))}
          </div>
        )}

        {!loading && !failed && data.fileType === 'pdf' && !showOcr && (
          <div className="pdf-surface" ref={pdfSurfaceRef}>
            {pdfError ? (
              <div className="flex flex-col items-start gap-2 p-5">
                <p className="text-sm text-destructive">{pdfError}</p>
              </div>
            ) : pdfBytes ? (
              <PdfDocument
                file={{ data: pdfBytes }}
                onLoadError={() => setPdfError('PDF 渲染失败。')}
                loading={<div className="p-5 text-sm text-muted-foreground">加载 PDF</div>}
              >
                <div data-pdf-page={data.currentPage}>
                  <Page
                    pageNumber={data.currentPage}
                    width={Math.min(980, Math.max(260, pageWidth - 4))}
                    renderAnnotationLayer={false}
                    renderTextLayer
                    loading={<div className="pdf-page-skeleton" />}
                  />
                </div>
              </PdfDocument>
            ) : (
              <div className="p-5 text-sm text-muted-foreground">读取 PDF</div>
            )}
          </div>
        )}

        {!loading && !failed && data.fileType === 'markdown' && (
          <Markdown className="document-markdown">{data.text}</Markdown>
        )}

        {!loading && !failed && data.fileType === 'text' && (
          <pre className="document-text">{data.text}</pre>
        )}
      </div>

      <SelectionPopover
        selection={pending}
        onClose={close}
        onAsk={(selection) => {
          createBranch(node.id, {
            quote: selection.quote,
            page: selection.page,
            view: selection.view,
          })
          close()
        }}
      />
    </div>
  )
}

function DocumentNodeComponent({ id, selected }: NodeProps<CanvasNode>) {
  const node = useCanvasStore((state) => state.nodes.find((entry) => entry.id === id))
  if (!node || node.data.kind !== 'document') return null

  return (
    <>
      <NodeResizer
        minWidth={NODE_SIZES.document.minWidth}
        minHeight={NODE_SIZES.document.minHeight}
        isVisible={Boolean(selected)}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <NodeShell node={node} selected={Boolean(selected)} mode="canvas">
        <DocumentBody node={node as CanvasNode & { data: DocumentNodeData }} mode="canvas" />
      </NodeShell>
    </>
  )
}

export default DocumentNodeComponent
