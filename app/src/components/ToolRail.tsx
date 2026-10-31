import { FileUp, Hand, Maximize2, MessageSquarePlus, MousePointer2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ToolRailProps {
  panMode: boolean
  onPanModeChange: (enabled: boolean) => void
  onNewChat: () => void
  onImport: () => void
  onFit: () => void
  hasNodes: boolean
}

export function ToolRail({
  panMode,
  onPanModeChange,
  onNewChat,
  onImport,
  onFit,
  hasNodes,
}: ToolRailProps) {
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
          <Button variant="ghost" size="icon-sm" onClick={onNewChat} aria-label="新建对话">
            <MessageSquarePlus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">新建对话 (C)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onImport} aria-label="导入文档">
            <FileUp />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">导入文档 (D)</TooltipContent>
      </Tooltip>
      <Separator className="my-0.5 w-6" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onFit} disabled={!hasNodes} aria-label="适应全部">
            <Maximize2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">适应全部</TooltipContent>
      </Tooltip>
    </div>
  )
}
