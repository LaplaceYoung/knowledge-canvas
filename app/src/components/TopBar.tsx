import { FileUp, SlidersHorizontal, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCanvasStore } from '@/store/canvas-store'

interface TopBarProps {
  onNewChat: () => void
  onImport: () => void
}

export function TopBar({ onNewChat, onImport }: TopBarProps) {
  const canvasTitle = useCanvasStore((state) => state.canvasTitle)
  const setCanvasTitle = useCanvasStore((state) => state.setCanvasTitle)
  const apiConfig = useCanvasStore((state) => state.apiConfig)
  const openSettings = useCanvasStore((state) => state.openSettings)
  const nodeCount = useCanvasStore((state) => state.nodes.length)
  const configured = Boolean(apiConfig.model && apiConfig.baseUrl)

  return (
    <header className="z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <Input
        value={canvasTitle}
        aria-label="画布名称"
        onChange={(event) => setCanvasTitle(event.target.value)}
        className="h-8 w-56 border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:border-input focus-visible:border-ring"
      />
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {nodeCount > 0 ? `${nodeCount} 个节点` : '空白画布'}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => openSettings('model')}
        >
          <span
            className={`size-2 rounded-full ${configured ? 'bg-ring' : 'border border-muted-foreground/50'}`}
            aria-hidden="true"
          />
          <span className="max-w-36 truncate text-foreground">
            {apiConfig.model || '配置模型'}
          </span>
          <SlidersHorizontal className="size-3.5" />
        </Button>
        <Button variant="outline" size="sm" onClick={onImport}>
          <FileUp />
          导入
        </Button>
        <Button size="sm" onClick={onNewChat}>
          <SquarePen />
          新对话
        </Button>
      </div>
    </header>
  )
}
