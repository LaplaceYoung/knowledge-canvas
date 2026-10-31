import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { buildCanvasExportDocument, canvasToHtml, canvasToMarkdown, downloadTextFile } from '@/lib/export'
import { useCanvasStore } from '@/store/canvas-store'

function safeFileName(title: string): string {
  const normalized = title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 48)
  return normalized || 'knowledge-canvas'
}

export function ExportMenu() {
  const canvasTitle = useCanvasStore((state) => state.canvasTitle)
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const viewport = useCanvasStore((state) => state.viewport)
  const nodes = useCanvasStore((state) => state.nodes)
  const [busy, setBusy] = useState(false)

  const document = useCallback(
    () => buildCanvasExportDocument(canvasTitle, activeCanvasId, viewport, nodes),
    [activeCanvasId, canvasTitle, nodes, viewport],
  )

  const run = async (kind: 'json' | 'markdown' | 'html') => {
    setBusy(true)
    try {
      const doc = document()
      const base = safeFileName(doc.title)
      if (kind === 'json') {
        downloadTextFile(`${base}.canvas.json`, JSON.stringify(doc, null, 2), 'application/json;charset=utf-8')
      } else if (kind === 'markdown') {
        downloadTextFile(`${base}.md`, canvasToMarkdown(doc), 'text/markdown;charset=utf-8')
      } else {
        downloadTextFile(`${base}.html`, canvasToHtml(doc), 'text/html;charset=utf-8')
      }
      toast.success('已导出。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy || !nodes.length} aria-label="导出画布">
          <Download />
          导出
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>导出当前画布</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void run('json')}>JSON 快照</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run('markdown')}>Markdown 摘要</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void run('html')}>只读 HTML</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
