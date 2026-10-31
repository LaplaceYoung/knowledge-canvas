import { createPortal } from 'react-dom'
import { Clipboard, CornerDownRight } from 'lucide-react'
import type { SelectionPayload } from '@/hooks/use-selection-tool'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'

interface SelectionPopoverProps {
  selection: (SelectionPayload & { x: number; y: number }) | null
  onAsk: (selection: SelectionPayload) => void
  onClose: () => void
}

export function SelectionPopover({ selection, onAsk, onClose }: SelectionPopoverProps) {
  if (!selection) return null

  const copy = async () => {
    await copyText(selection.quote)
    onClose()
  }

  return createPortal(
    <div
      className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ left: selection.x, top: selection.y }}
      onMouseDown={(event) => event.preventDefault()}
      role="dialog"
      aria-label="选中文本操作"
    >
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2" onClick={() => onAsk(selection)}>
        <CornerDownRight className="size-3.5" />
        追问
        <Kbd className="ml-1">↵</Kbd>
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={copy} title="复制选段" aria-label="复制选段">
        <Clipboard />
      </Button>
    </div>,
    document.body,
  )
}
