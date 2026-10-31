import { Hand, MousePointer2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ToolRailProps {
  panMode: boolean
  onPanModeChange: (enabled: boolean) => void
  onCreate: () => void
}

export function ToolRail({ panMode, onPanModeChange, onCreate }: ToolRailProps) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-card p-1 shadow-sm" role="toolbar" aria-label="画布工具">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={!panMode ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => onPanModeChange(false)}
            aria-label="选择工具"
          >
            <MousePointer2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">选择工具 (V)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={panMode ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => onPanModeChange(true)}
            aria-label="抓手工具"
          >
            <Hand />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">抓手工具 (H)</TooltipContent>
      </Tooltip>
      <Separator className="my-0.5 w-6" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onCreate} aria-label="连接网页">
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">连接网页（双击空白）</TooltipContent>
      </Tooltip>
    </div>
  )
}
