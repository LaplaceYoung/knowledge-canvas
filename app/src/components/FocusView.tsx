import { useEffect, useMemo } from 'react'
import { Crosshair } from 'lucide-react'
import { ChatBody } from '@/components/ChatNode'
import { DocumentBody } from '@/components/DocumentNode'
import { WebBody } from '@/components/WebNode'
import { NodeShell } from '@/components/NodeShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasNode, ChatNodeData, DocumentNodeData, WebNodeData } from '@/types/canvas'

export function FocusView() {
  const focusedNodeId = useCanvasStore((state) => state.focusedNodeId)
  const nodes = useCanvasStore((state) => state.nodes)
  const setFocusedNodeId = useCanvasStore((state) => state.setFocusedNodeId)
  const setRevealNodeId = useCanvasStore((state) => state.setRevealNodeId)
  const sidebarCollapsed = useCanvasStore((state) => state.sidebarCollapsed)

  const node = focusedNodeId ? nodes.find((entry) => entry.id === focusedNodeId) : null

  const ancestry = useMemo(() => {
    if (!node) return []
    const byId = new Map(nodes.map((entry) => [entry.id, entry]))
    const chain: CanvasNode[] = []
    let cursor: CanvasNode | undefined = node
    const visited = new Set<string>()
    while (cursor) {
      chain.unshift(cursor)
      if (!cursor.data.parentId || visited.has(cursor.data.parentId)) break
      visited.add(cursor.data.parentId)
      cursor = byId.get(cursor.data.parentId)
    }
    return chain
  }, [node, nodes])

  useEffect(() => {
    if (!focusedNodeId) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'Escape') setFocusedNodeId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedNodeId, setFocusedNodeId])

  if (!node) return null

  return (
    <div className={cn(
      'fixed bottom-0 right-0 top-12 z-40 bg-background',
      sidebarCollapsed ? 'left-14' : 'left-56',
    )} role="dialog" aria-modal="true" aria-label={`专注阅读：${node.data.title}`}>
      <div className="flex h-full flex-col px-3 pb-3">
        <div className="flex h-10 flex-none items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span>画布</span>
            {ancestry.slice(0, -1).map((entry) => (
              <span key={entry.id} className="contents">
                <span aria-hidden="true">/</span>
                <span className="max-w-40 truncate">{entry.data.title}</span>
              </span>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => {
              setFocusedNodeId(null)
              setRevealNodeId(node.id)
            }}
          >
            <Crosshair />
            在画布中定位
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          <NodeShell node={node} selected={false} mode="focus">
            {node.data.kind === 'chat' ? (
              <ChatBody node={node as CanvasNode & { data: ChatNodeData }} />
            ) : node.data.kind === 'web' ? (
              <WebBody node={node as CanvasNode & { data: WebNodeData }} />
            ) : (
              <DocumentBody node={node as CanvasNode & { data: DocumentNodeData }} mode="focus" />
            )}
          </NodeShell>
        </div>
      </div>
    </div>
  )
}
