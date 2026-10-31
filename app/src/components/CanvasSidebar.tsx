import { LayoutGrid, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/store/canvas-store'

export function CanvasSidebar() {
  const canvases = useCanvasStore((state) => state.canvases)
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvasTitle = useCanvasStore((state) => state.canvasTitle)
  const createCanvas = useCanvasStore((state) => state.createCanvas)
  const switchCanvas = useCanvasStore((state) => state.switchCanvas)

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-3 text-sm font-semibold tracking-tight">
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
          {canvases.map((canvas) => {
            const active = canvas.id === activeCanvasId
            const title = active ? canvasTitle : canvas.title
            return (
              <button
                key={canvas.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                title={title || '未命名画布'}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                )}
                onClick={() => switchCanvas(canvas.id)}
              >
                <LayoutGrid className="size-4 shrink-0 opacity-70" />
                <span className="truncate">{title.trim() || '未命名画布'}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}
