import { useState, type ReactNode } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import { FileText, Globe2, Maximize2, MessageSquare, Trash2, X } from 'lucide-react'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasNode } from '@/types/canvas'
import { formatSourcePage } from '@/lib/context'
import { getNodeSize } from '@/lib/layout'
import { cancelDocumentOcr } from '@/lib/ocr-runner'
import { openWebNodePage } from '@/lib/web-node-service'
import { getWebProvider, webUrlLabel } from '@/lib/web-providers'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface NodeShellProps {
  node: CanvasNode
  selected: boolean
  mode: 'canvas' | 'focus'
  children: ReactNode
}

export function NodeShell({ node, selected, mode, children }: NodeShellProps) {
  const setNodeTitle = useCanvasStore((state) => state.setNodeTitle)
  const setFocusedNodeId = useCanvasStore((state) => state.setFocusedNodeId)
  const removeNode = useCanvasStore((state) => state.removeNode)
  const requestSourceJump = useCanvasStore((state) => state.requestSourceJump)
  const { setCenter } = useReactFlow()
  const childCount = useCanvasStore(
    (state) => state.nodes.filter((entry) => entry.data.parentId === node.id).length,
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const source = node.data.source
  const isChat = node.data.kind === 'chat'
  const webData = node.data.kind === 'web' ? node.data : null
  const isWeb = Boolean(webData)
  const webProvider = webData ? getWebProvider(webData.providerId) : null
  const loading =
    (node.data.kind === 'document' && node.data.status === 'loading') ||
    Boolean(webData && webData.bindingState === 'opening')
  const error =
    (node.data.kind === 'document' && node.data.status === 'error') ||
    Boolean(webData && (webData.bindingState === 'error' || webData.mirrorState === 'error'))
  const ocrRunning = node.data.kind === 'document' && node.data.ocrStatus === 'running'
  const summary =
    node.data.kind === 'chat'
      ? [...node.data.messages]
          .reverse()
          .find((message) => message.role === 'assistant')
          ?.content.slice(0, 180)
      : webData
        ? `${webProvider?.label ?? 'Web'}${
            webData.visibleMessages.length
              ? ` · ${webData.visibleMessages.at(-1)?.content.slice(0, 140)}`
              : ` · ${webUrlLabel(webData.conversationUrl)}`
          }`
        : `${node.data.fileName}${node.data.pageCount ? ` · ${node.data.pageCount} 页` : ''}`
  const typeLabel = isChat ? '对话' : isWeb ? 'Web' : '文档'

  const focusNode = () => {
    if (
      webData &&
      (webData.syncMode !== 'dom-mirror' || webData.bindingState !== 'bound')
    ) {
      void openWebNodePage(node.id)
      return
    }
    setFocusedNodeId(node.id)
  }

  return (
    <section
      className={cn(
        `canvas-node canvas-node--${node.data.kind}`,
        'group relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs',
        selected && 'border-ring ring-1 ring-ring',
        mode === 'focus' && 'is-focus rounded-none border-0 shadow-none ring-0',
      )}
      aria-label={`${typeLabel}：${node.data.title}`}
    >
      {mode === 'canvas' && (
        <>
          <Handle type="target" position={Position.Left} className="canvas-handle" isConnectable={false} />
          <Handle type="source" position={Position.Right} className="canvas-handle" isConnectable={false} />
        </>
      )}
      <button
        type="button"
        className="node-map-pill absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs shadow-sm"
        onClick={() => {
          const size = getNodeSize(node)
          setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2, {
            zoom: 1,
            duration: 240,
          })
        }}
        title="回到可读缩放"
      >
        {isChat ? (
          <MessageSquare className="size-3" />
        ) : isWeb ? (
          <Globe2 className="size-3" />
        ) : (
          <FileText className="size-3" />
        )}
        <span className="max-w-40 truncate">{node.data.title}</span>
      </button>

      <header className="node-drag-handle flex h-10 flex-none cursor-grab items-center gap-1.5 border-b px-2 active:cursor-grabbing">
        <span className="grid size-6 shrink-0 place-items-center text-muted-foreground" aria-hidden="true">
          {isChat ? (
            <MessageSquare className="size-3.5" />
          ) : isWeb ? (
            <Globe2 className="size-3.5" />
          ) : (
            <FileText className="size-3.5" />
          )}
        </span>
        {mode === 'canvas' ? (
          <Input
            className="nodrag h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-[13px] font-medium shadow-none focus-visible:border-0 focus-visible:ring-0"
            value={node.data.title}
            aria-label="节点标题"
            onChange={(event) => setNodeTitle(node.id, event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate px-1 text-[13px] font-medium">{node.data.title}</h2>
        )}
        {loading && <Badge variant="secondary">{isWeb ? '连接中' : '解析中'}</Badge>}
        {ocrRunning && <Badge variant="secondary">OCR</Badge>}
        {isWeb && webData?.bindingState === 'extension-missing' && (
          <Badge variant="outline">快捷入口</Badge>
        )}
        {isWeb && webData?.mirrorState === 'answering' && (
          <Badge variant="secondary">回答中</Badge>
        )}
        {isWeb &&
          webData?.syncMode === 'dom-mirror' &&
          webData.bindingState === 'bound' &&
          webData.mirrorState === 'ready' && <Badge variant="secondary">镜像</Badge>}
        {error && <Badge variant="destructive">失败</Badge>}
        <div
          className={cn(
            'nodrag flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
            (selected || mode === 'focus') && 'opacity-100',
          )}
        >
          {mode === 'canvas' ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                title={
                  webData && (webData.syncMode !== 'dom-mirror' || webData.bindingState !== 'bound')
                    ? '打开真实网页'
                    : '专注阅读'
                }
                aria-label={
                  webData && (webData.syncMode !== 'dom-mirror' || webData.bindingState !== 'bound')
                    ? '打开真实网页'
                    : '专注阅读'
                }
                onClick={focusNode}
              >
                <Maximize2 />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="删除节点"
                aria-label="删除节点"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              title="返回画布"
              aria-label="返回画布"
              onClick={() => setFocusedNodeId(null)}
            >
              <X />
            </Button>
          )}
        </div>
      </header>

      {source && (
        <button
          type="button"
          className={cn(
            'mx-3 mt-2 flex flex-none flex-col gap-1 rounded-md bg-muted/60 px-2.5 py-2 text-left transition-colors hover:bg-muted',
            source.frozen && 'cursor-default opacity-70',
          )}
          disabled={source.frozen}
          onClick={() => {
            if (source.frozen) return
            requestSourceJump({
              nodeId: source.parentNodeId,
              messageId: source.parentMessageId,
              page: source.page,
              view: source.view,
              quote: source.quote,
            })
          }}
          title={source.frozen ? '来源节点已删除，当前分支已停止同步' : '回到来源'}
        >
          <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
            <span className="truncate">
              {source.frozen ? '来源已删除' : source.parentTitle}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{formatSourcePage(source.page, source.view)}</span>
          </span>
          <q className="line-clamp-2 text-[13px] leading-5 text-foreground">{source.quote}</q>
        </button>
      )}

      {summary && <div className="node-overview-summary px-3 py-3 text-sm leading-6 text-muted-foreground">{summary}</div>}

      {children}

      <ConfirmDialog
        open={confirmingDelete}
        title={`删除「${node.data.title}」？`}
        description={
          childCount > 0
            ? `它的 ${childCount} 个直接下游分支会保留，但停止继承该节点。此操作不能撤销。`
            : '节点内容和本地记录会被删除。此操作不能撤销。'
        }
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false)
          if (node.data.kind === 'document') cancelDocumentOcr(node.id)
          removeNode(node.id)
        }}
      />
    </section>
  )
}
