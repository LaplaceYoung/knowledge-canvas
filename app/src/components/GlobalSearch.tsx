import { useEffect, useMemo, useState } from 'react'
import { FileText, Globe, MessageSquare, Pin } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasNode } from '@/types/canvas'

interface SearchEntry {
  id: string
  canvasId: string
  canvasTitle: string
  node: CanvasNode
  kind: string
  text: string
}

function nodeKindLabel(node: CanvasNode): string {
  return node.data.kind === 'chat' ? '对话' : node.data.kind === 'document' ? '文档' : 'Web'
}

function nodeText(node: CanvasNode): string {
  if (node.data.kind === 'chat') {
    return [node.data.title, ...node.data.messages.map((message) => message.content)].join('\n')
  }
  if (node.data.kind === 'web') {
    return [
      node.data.title,
      node.data.conversationUrl ?? '',
      node.data.pageTitle ?? '',
      ...node.data.visibleMessages.map((message) => message.content),
    ].join('\n')
  }
  return [node.data.title, node.data.fileName, node.data.text].join('\n')
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const nodes = useCanvasStore((state) => state.nodes)
  const canvases = useCanvasStore((state) => state.canvases)
  const canvasSnapshots = useCanvasStore((state) => state.canvasSnapshots)
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const switchCanvas = useCanvasStore((state) => state.switchCanvas)
  const setRevealNodeId = useCanvasStore((state) => state.setRevealNodeId)
  const setSelectedNodeId = useCanvasStore((state) => state.setSelectedNodeId)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
      if (event.key === '/' && !(event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]'))) {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const entries = useMemo<SearchEntry[]>(() => {
    const active = nodes.map((node) => ({
      id: node.id,
      canvasId: activeCanvasId,
      canvasTitle: canvases.find((canvas) => canvas.id === activeCanvasId)?.title ?? '当前画布',
      node,
      kind: nodeKindLabel(node),
      text: nodeText(node),
    }))
    const snapshots = Object.entries(canvasSnapshots).flatMap(([canvasId, snapshot]) =>
      snapshot.nodes.map((node) => ({
        id: `${canvasId}:${node.id}`,
        canvasId,
        canvasTitle: canvases.find((canvas) => canvas.id === canvasId)?.title ?? snapshot.title,
        node,
        kind: nodeKindLabel(node),
        text: nodeText(node),
      })),
    )
    return [...active, ...snapshots]
  }, [activeCanvasId, canvasSnapshots, canvases, nodes])

  const choose = (entry: SearchEntry) => {
    if (entry.canvasId !== activeCanvasId) switchCanvas(entry.canvasId)
    setOpen(false)
    window.setTimeout(() => {
      setSelectedNodeId(entry.node.id)
      setRevealNodeId(entry.node.id)
    }, 30)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="搜索画布" description="跨画布搜索">
      <CommandInput placeholder="搜索节点标题、消息、文档和 Web 页面" />
      <CommandList>
        <CommandEmpty>没有找到匹配内容。</CommandEmpty>
        <CommandGroup heading="全部画布">
          {entries.map((entry) => (
            <CommandItem
              key={entry.id}
              value={entry.text}
              onSelect={() => choose(entry)}
            >
              {entry.node.data.kind === 'chat' ? (
                <MessageSquare />
              ) : entry.node.data.kind === 'document' ? (
                <FileText />
              ) : (
                <Globe />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{entry.node.data.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {`${entry.canvasTitle} · ${entry.kind}`}
                </span>
              </span>
              {entry.canvasId !== activeCanvasId &&
                canvases.find((canvas) => canvas.id === entry.canvasId)?.pinned && (
                  <Pin className="size-3.5 text-muted-foreground" />
                )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
