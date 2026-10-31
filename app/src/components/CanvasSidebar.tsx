import { useMemo, useState } from 'react'
import { LayoutGrid, Pin, Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { unbindWebNodes } from '@/lib/web-node-service'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasSummary } from '@/types/canvas'

export function CanvasSidebar() {
  const canvases = useCanvasStore((state) => state.canvases)
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvasTitle = useCanvasStore((state) => state.canvasTitle)
  const createCanvas = useCanvasStore((state) => state.createCanvas)
  const switchCanvas = useCanvasStore((state) => state.switchCanvas)
  const deleteCanvas = useCanvasStore((state) => state.deleteCanvas)
  const toggleCanvasPin = useCanvasStore((state) => state.toggleCanvasPin)
  const reorderCanvas = useCanvasStore((state) => state.reorderCanvas)
  const nodes = useCanvasStore((state) => state.nodes)
  const canvasSnapshots = useCanvasStore((state) => state.canvasSnapshots)
  const [deletingCanvas, setDeletingCanvas] = useState<CanvasSummary | null>(null)
  const [dragCanvasId, setDragCanvasId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const pinnedCanvases = useMemo(
    () => canvases.filter((canvas) => canvas.pinned),
    [canvases],
  )
  const unpinnedCanvases = useMemo(
    () => canvases.filter((canvas) => !canvas.pinned),
    [canvases],
  )

  const canDelete = canvases.length > 1
  const displayTitle = (canvas: CanvasSummary) =>
    (canvas.id === activeCanvasId ? canvasTitle : canvas.title).trim() || '未命名画布'

  const deleteWithBindings = async (canvas: CanvasSummary) => {
    const targetNodes =
      canvas.id === activeCanvasId ? nodes : (canvasSnapshots[canvas.id]?.nodes ?? [])
    await unbindWebNodes(
      targetNodes
        .filter((node) => node.data.kind === 'web')
        .map((node) => node.id),
    )
    deleteCanvas(canvas.id)
    setDeletingCanvas(null)
  }

  const renderCanvas = (canvas: CanvasSummary) => {
    const active = canvas.id === activeCanvasId
    const pinned = Boolean(canvas.pinned)
    const title = displayTitle(canvas)

    return (
      <div
        key={canvas.id}
        draggable
        onDragStart={(event) => {
          setDragCanvasId(canvas.id)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', canvas.id)
        }}
        onDragOver={(event) => {
          if (!dragCanvasId || dragCanvasId === canvas.id) return
          const source = canvases.find((entry) => entry.id === dragCanvasId)
          if (!source || Boolean(source.pinned) !== pinned) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTargetId(canvas.id)
        }}
        onDragLeave={() => {
          setDropTargetId((current) => (current === canvas.id ? null : current))
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (dragCanvasId) reorderCanvas(dragCanvasId, canvas.id)
          setDragCanvasId(null)
          setDropTargetId(null)
        }}
        onDragEnd={() => {
          setDragCanvasId(null)
          setDropTargetId(null)
        }}
        className={cn(
          'group flex h-9 items-center gap-0.5 rounded-md px-1 transition-colors',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          dragCanvasId === canvas.id && 'opacity-50',
          dropTargetId === canvas.id && 'ring-1 ring-inset ring-ring',
        )}
      >
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          title={title}
          className="flex h-full min-w-0 flex-1 cursor-grab items-center gap-2 px-1 text-left text-[13px] active:cursor-grabbing"
          onClick={() => switchCanvas(canvas.id)}
        >
          <LayoutGrid className="size-4 shrink-0 opacity-70" />
          <span className="truncate">{title}</span>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            'size-6 shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground',
            pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          title={pinned ? '取消 Pin' : 'Pin 到顶部'}
          aria-label={pinned ? '取消 Pin' : 'Pin 到顶部'}
          onClick={() => toggleCanvasPin(canvas.id)}
        >
          <Pin className={cn('size-3.5', pinned && 'fill-current')} />
        </Button>

        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0 text-sidebar-foreground/60 opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
            title="删除画布"
            aria-label="删除画布"
            onClick={() => setDeletingCanvas(canvas)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-3 text-sm font-semibold tracking-tight">
        <img
          src="/brand/icon.svg"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="size-6 shrink-0"
        />
        Knowledge Canvas
      </div>

      <div className="shrink-0 p-2">
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2.5 text-[13px] font-normal text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => createCanvas()}
        >
          <Plus className="size-4" />
          新建画布
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="画布列表">
        <div className="flex flex-col gap-0.5">
          {pinnedCanvases.map(renderCanvas)}
          {pinnedCanvases.length > 0 && unpinnedCanvases.length > 0 && (
            <div className="my-1 h-px bg-sidebar-border" aria-hidden="true" />
          )}
          {unpinnedCanvases.map(renderCanvas)}
        </div>
      </nav>

      <ConfirmDialog
        open={Boolean(deletingCanvas)}
        title={`删除「${deletingCanvas ? displayTitle(deletingCanvas) : ''}」？`}
        description="画布和其中的节点会从本地删除。此操作不能撤销。"
        onClose={() => setDeletingCanvas(null)}
        onConfirm={() => {
          if (deletingCanvas) void deleteWithBindings(deletingCanvas)
          else setDeletingCanvas(null)
        }}
      />
    </aside>
  )
}
