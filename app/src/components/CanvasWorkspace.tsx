import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useViewport,
  type Edge,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import ChatNode from '@/components/ChatNode'
import DocumentNode from '@/components/DocumentNode'
import WebNode from '@/components/WebNode'
import { WebNodeDialog } from '@/components/WebNodeDialog'
import { ToolRail } from '@/components/ToolRail'
import { TopBar } from '@/components/TopBar'
import { Button } from '@/components/ui/button'
import { detectDocumentType, importDocument } from '@/lib/files'
import { getNodeSize } from '@/lib/layout'
import { runDocumentOcr } from '@/lib/ocr-runner'
import { connectWebNode, openWebNodePage } from '@/lib/web-node-service'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasNode } from '@/types/canvas'
import type { WebProviderId } from '@/types/canvas'
import { NODE_SIZES } from '@/types/canvas'

const nodeTypes: NodeTypes = {
  chat: ChatNode,
  document: DocumentNode,
  web: WebNode,
}

function CanvasNavigation() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const viewport = useViewport()
  const nodes = useCanvasStore((state) => state.nodes)

  return (
    <Panel position="bottom-right" className="!m-3 flex flex-col items-end gap-2">
      <div className="relative overflow-hidden rounded-lg border bg-card shadow-sm">
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            node.selected
              ? 'oklch(0.68 0.13 250)'
              : (node.data as CanvasNode['data']).kind === 'document'
                ? 'oklch(0.48 0.01 260)'
                : 'oklch(0.38 0.012 260)'
          }
          nodeStrokeWidth={0}
          maskColor="oklch(0.16 0.005 260 / 0.72)"
          style={{ position: 'relative', width: 176, height: 104, margin: 0 }}
        />
        <span className="absolute left-2 top-2 rounded bg-card/80 px-1 text-xs text-muted-foreground">
          {nodes.length} 个节点
        </span>
      </div>
      <div className="flex items-center rounded-lg border bg-card p-1 shadow-sm">
        <Button variant="ghost" size="icon-sm" aria-label="缩小" onClick={() => zoomOut({ duration: 160 })}>
          <Minus />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="放大" onClick={() => zoomIn({ duration: 160 })}>
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-0.5"
          onClick={() => fitView({ padding: 0.18, duration: 220, maxZoom: 1 })}
        >
          适应
        </Button>
      </div>
    </Panel>
  )
}

export function CanvasWorkspace() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [panMode, setPanMode] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [webDialogOpen, setWebDialogOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [zoomTier, setZoomTier] = useState<'detail' | 'overview' | 'map'>('detail')
  const nodes = useCanvasStore((state) => state.nodes)
  const viewport = useCanvasStore((state) => state.viewport)
  const ocrConfig = useCanvasStore((state) => state.ocrConfig)
  const onNodesChange = useCanvasStore((state) => state.onNodesChange)
  const setViewport = useCanvasStore((state) => state.setViewport)
  const setSelectedNodeId = useCanvasStore((state) => state.setSelectedNodeId)
  const setFocusedNodeId = useCanvasStore((state) => state.setFocusedNodeId)
  const addChatNode = useCanvasStore((state) => state.addChatNode)
  const addDocumentNode = useCanvasStore((state) => state.addDocumentNode)
  const addWebNode = useCanvasStore((state) => state.addWebNode)
  const finishDocumentImport = useCanvasStore((state) => state.finishDocumentImport)
  const failDocumentImport = useCanvasStore((state) => state.failDocumentImport)
  const revealNodeId = useCanvasStore((state) => state.revealNodeId)
  const setRevealHandled = useCanvasStore((state) => state.setRevealHandled)
  const { screenToFlowPosition, fitView, setCenter, getZoom } = useReactFlow<CanvasNode>()

  const edges = useMemo<Edge[]>(
    () =>
      nodes
        .filter((node) => node.data.parentId)
        .map((node) => ({
          id: `edge-${node.data.parentId}-${node.id}`,
          source: node.data.parentId as string,
          target: node.id,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 13,
            height: 13,
            color: 'var(--muted-foreground)',
          },
          style: { stroke: 'var(--border)', strokeWidth: 1.5 },
        })),
    [nodes],
  )

  const centerPoint = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    return {
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    }
  }, [])

  const createChatAtCenter = useCallback(() => {
    const point = screenToFlowPosition(centerPoint())
    addChatNode({
      x: point.x - NODE_SIZES.chat.width / 2,
      y: point.y - NODE_SIZES.chat.height / 2,
    })
  }, [addChatNode, centerPoint, screenToFlowPosition])

  const createWebAtCenter = useCallback(
    (providerId: WebProviderId) => {
      const point = screenToFlowPosition(centerPoint())
      const id = addWebNode(providerId, {
        x: point.x - NODE_SIZES.web.width / 2,
        y: point.y - NODE_SIZES.web.height / 2,
      })
      setWebDialogOpen(false)
      void connectWebNode(id)
    },
    [addWebNode, centerPoint, screenToFlowPosition],
  )

  const importFiles = useCallback(
    async (files: File[], clientPoint?: { x: number; y: number }) => {
      if (!files.length) return
      const baseScreen = clientPoint ?? centerPoint()
      const basePoint = screenToFlowPosition(baseScreen)

      for (const [index, file] of files.entries()) {
        const type = detectDocumentType(file)
        if (!type) {
          toast.error(`不支持「${file.name}」，请选择 PDF、Markdown 或 TXT。`)
          continue
        }
        const nodeId = addDocumentNode(
          {
            title: file.name,
            fileName: file.name,
            fileType: type,
          },
          {
            x: basePoint.x + index * 36,
            y: basePoint.y + index * 36,
          },
        )

        try {
          const imported = await importDocument(file, nodeId)
          finishDocumentImport(nodeId, {
            fileType: imported.fileType,
            text: imported.text,
            pages: imported.pages,
            pageCount: imported.pageCount,
            assetId: imported.assetId,
          })
          if (imported.needsOcr && ocrConfig.autoRun) {
            void runDocumentOcr(nodeId)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '文档导入失败。'
          failDocumentImport(nodeId, message)
          toast.error(message)
        }
      }
    },
    [addDocumentNode, centerPoint, failDocumentImport, finishDocumentImport, ocrConfig.autoRun, screenToFlowPosition],
  )

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), [])

  useEffect(() => {
    if (!revealNodeId) return
    const node = nodes.find((entry) => entry.id === revealNodeId)
    if (!node) {
      setRevealHandled()
      return
    }
    const size = getNodeSize(node)
    const viewportRect = wrapperRef.current?.getBoundingClientRect()
    const availableWidth = Math.max(320, (viewportRect?.width ?? window.innerWidth) - 80)
    const availableHeight = Math.max(320, (viewportRect?.height ?? window.innerHeight) - 80)
    const parent = node.data.parentId ? nodes.find((entry) => entry.id === node.data.parentId) : undefined
    if (parent) {
      const parentSize = getNodeSize(parent)
      const left = Math.min(parent.position.x, node.position.x)
      const right = Math.max(parent.position.x + parentSize.width, node.position.x + size.width)
      const top = Math.min(parent.position.y, node.position.y)
      const bottom = Math.max(parent.position.y + parentSize.height, node.position.y + size.height)
      const pairFit = Math.min(availableWidth / (right - left), availableHeight / (bottom - top), 0.9)
      if (pairFit >= 0.55) {
        setCenter((left + right) / 2, (top + bottom) / 2, { zoom: pairFit, duration: 260 })
      } else {
        const childFit = Math.min(availableWidth / size.width, availableHeight / size.height, 1)
        setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2, {
          zoom: Math.max(0.65, childFit),
          duration: 260,
        })
      }
    } else {
      const fitZoom = Math.min(availableWidth / size.width, availableHeight / size.height, 1)
      setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2, {
        zoom: Math.max(0.6, fitZoom),
        duration: 260,
      })
    }
    setRevealHandled()
  }, [getZoom, nodes, revealNodeId, setCenter, setRevealHandled])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key.toLowerCase() === 'v') setPanMode(false)
      if (event.key.toLowerCase() === 'h') setPanMode(true)
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        createChatAtCenter()
      }
      if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        openFilePicker()
      }
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        setWebDialogOpen(true)
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        if (event.shiftKey) fitView({ padding: 0.18, duration: 220, maxZoom: 1 })
        else {
          const selected = nodes.find((node) => node.selected)
          if (selected) {
            const size = getNodeSize(selected)
            setCenter(selected.position.x + size.width / 2, selected.position.y + size.height / 2, {
              zoom: Math.max(0.75, Math.min(1.2, getZoom())),
              duration: 220,
            })
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createChatAtCenter, fitView, getZoom, nodes, openFilePicker, setCenter])

  return (
    <div
      className={`canvas-workspace zoom-${zoomTier} ${panMode ? 'is-pan-mode' : ''}`}
      style={
        {
          '--canvas-inverse-zoom': 1 / Math.max(zoom, 0.1),
        } as React.CSSProperties
      }
    >
      <TopBar onNewChat={createChatAtCenter} onImport={openFilePicker} />
      <div
        className="canvas-stage"
        ref={wrapperRef}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setDragActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          void importFiles(Array.from(event.dataTransfer.files), {
            x: event.clientX,
            y: event.clientY,
          })
        }}
      >
        <ReactFlow<CanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={viewport}
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          zoomOnPinch
          panOnDrag={panMode ? true : [1, 2]}
          selectionOnDrag={!panMode}
          nodesDraggable={!panMode}
          nodesConnectable={false}
          deleteKeyCode={null}
          snapToGrid
          snapGrid={[8, 8]}
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
          onMove={(_, nextViewport) => {
            setZoom(nextViewport.zoom)
            setZoomTier(nextViewport.zoom >= 0.6 ? 'detail' : nextViewport.zoom >= 0.25 ? 'overview' : 'map')
          }}
          onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          onNodeDoubleClick={(event, node) => {
            const target = event.target as HTMLElement
            if (target.closest('input, textarea, button, a')) return
            if (
              node.data.kind === 'web' &&
              (node.data.syncMode !== 'dom-mirror' || node.data.bindingState !== 'bound')
            ) {
              void openWebNodePage(node.id)
              return
            }
            setFocusedNodeId(node.id)
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)" />
          <Panel position="top-left" className="!m-3">
            <ToolRail
              panMode={panMode}
              onPanModeChange={setPanMode}
              onNewChat={createChatAtCenter}
              onNewWeb={() => setWebDialogOpen(true)}
              onImport={openFilePicker}
              onFit={() => fitView({ padding: 0.18, duration: 220, maxZoom: 1 })}
              hasNodes={nodes.length > 0}
            />
          </Panel>
          {nodes.length > 0 && <CanvasNavigation />}
        </ReactFlow>

        {!nodes.length && (
          <div className="pointer-events-none absolute left-[max(88px,8vw)] top-[20%] z-10 w-[min(360px,calc(100vw-120px))]">
            <h1 className="text-2xl font-semibold tracking-tight">开始画布</h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              创建对话、导入文档，或新建一个连接真实网页的 Web 节点。选中文本后，可以创建保留来源的追问。
            </p>
            <div className="pointer-events-auto mt-5 flex flex-wrap gap-2">
              <Button onClick={createChatAtCenter}>新建对话</Button>
              <Button variant="outline" onClick={openFilePicker}>
                导入文档
              </Button>
              <Button variant="outline" onClick={() => setWebDialogOpen(true)}>
                新建 Web 节点
              </Button>
            </div>
            <div className="mt-8 hidden max-w-sm flex-wrap items-center gap-4 border-t pt-3 text-xs text-muted-foreground sm:flex">
              <span>Space 拖动画布</span>
              <span>C 新建对话</span>
              <span>D 导入文档</span>
              <span>W 新建 Web 节点</span>
            </div>
          </div>
        )}

        {dragActive && (
          <div className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ring bg-background/90 text-sm">
            <div className="font-medium">松开以导入文档</div>
            <span className="text-xs text-muted-foreground">PDF、Markdown 或 TXT</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.currentTarget.value = ''
            void importFiles(files)
          }}
        />

        <WebNodeDialog
          open={webDialogOpen}
          onOpenChange={setWebDialogOpen}
          onCreate={createWebAtCenter}
        />
      </div>
    </div>
  )
}
