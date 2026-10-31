import { applyNodeChanges, type NodeChange, type XYPosition } from '@xyflow/react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createId } from '@/lib/id'
import { findBranchPosition, findFreePosition } from '@/lib/layout'
import { removePdfAsset } from '@/lib/files'
import { snapshotContextForFrozenBranch } from '@/lib/context'
import { stopRequest } from '@/lib/request-registry'
import type {
  ApiConfig,
  CanvasNode,
  CanvasNodeData,
  CanvasSnapshot,
  CanvasSummary,
  CanvasViewport,
  ChatMessage,
  ChatNodeData,
  DocumentNodeData,
  OcrConfig,
  OcrPage,
  OcrRunStatus,
  SearchConfig,
  SettingsSection,
  SourceAnchor,
  SourceJumpRequest,
  TextLayer,
  WebNodeData,
  WebProviderId,
} from '@/types/canvas'
import {
  DEFAULT_API_CONFIG,
  DEFAULT_OCR_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  NODE_SIZES,
} from '@/types/canvas'
import { WEB_PROVIDERS } from '@/lib/web-providers'

const initialViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }
const initialCanvasId = createId('canvas')

interface CanvasState {
  activeCanvasId: string
  canvases: CanvasSummary[]
  canvasSnapshots: Record<string, CanvasSnapshot>
  nodes: CanvasNode[]
  viewport: CanvasViewport
  canvasTitle: string
  apiConfig: ApiConfig
  ocrConfig: OcrConfig
  searchConfig: SearchConfig
  contentFontSize: number
  sidebarCollapsed: boolean
  selectedNodeId: string | null
  focusedNodeId: string | null
  pendingInputNodeId: string | null
  revealNodeId: string | null
  sourceJump: SourceJumpRequest | null
  settingsOpen: boolean
  settingsSection: SettingsSection
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void
  setNodes: (nodes: CanvasNode[]) => void
  setViewport: (viewport: CanvasViewport) => void
  setCanvasTitle: (title: string) => void
  createCanvas: () => string
  switchCanvas: (id: string) => void
  deleteCanvas: (id: string) => void
  toggleCanvasPin: (id: string) => void
  reorderCanvas: (sourceId: string, targetId: string) => void
  setSelectedNodeId: (id: string | null) => void
  setFocusedNodeId: (id: string | null) => void
  setRevealNodeId: (id: string | null) => void
  setRevealHandled: () => void
  setPendingInputHandled: () => void
  setApiConfig: (config: ApiConfig) => void
  setOcrConfig: (config: OcrConfig) => void
  setSearchConfig: (config: SearchConfig) => void
  setContentFontSize: (size: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  openSettings: (section?: SettingsSection) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
  updateNodeData: (id: string, updater: (data: CanvasNodeData) => CanvasNodeData) => void
  setNodeTitle: (id: string, title: string) => void
  addChatNode: (position: XYPosition, parentId?: string, source?: SourceAnchor) => string
  addDocumentNode: (
    initial: Pick<DocumentNodeData, 'title' | 'fileName' | 'fileType'>,
    position: XYPosition,
  ) => string
  addWebNode: (providerId: WebProviderId, position: XYPosition) => string
  updateWebNodeData: (id: string, updater: (data: WebNodeData) => WebNodeData) => void
  finishDocumentImport: (id: string, data: Partial<DocumentNodeData>) => void
  failDocumentImport: (id: string, error: string) => void
  setDocumentPage: (id: string, page: number) => void
  setDocumentView: (id: string, view: TextLayer) => void
  beginOcrRun: (id: string, pages: number[], model: string) => void
  updateOcrPage: (id: string, page: number, update: Partial<Omit<OcrPage, 'number'>>) => void
  finishOcrRun: (id: string, error?: string) => void
  createBranch: (parentId: string, source: Omit<SourceAnchor, 'parentNodeId' | 'parentTitle'>) => string | null
  removeNode: (id: string) => void
  setChatError: (id: string, error: string) => void
  rewindToLastUser: (id: string) => string | null
  rewindToMessage: (id: string, messageId: string) => string | null
  startExchange: (id: string, userText: string, assistantId: string, model: string, contextNote?: string) => void
  appendAssistantDelta: (id: string, assistantId: string, delta: string) => void
  finishAssistant: (id: string, assistantId: string) => void
  failAssistant: (id: string, assistantId: string, error: string) => void
  stopAssistant: (id: string, assistantId: string) => void
  setChatContextNote: (id: string, note?: string) => void
  requestSourceJump: (request: Omit<SourceJumpRequest, 'nonce'>) => void
  clearSourceJump: () => void
}

function updateNodeById(
  nodes: CanvasNode[],
  id: string,
  updater: (node: CanvasNode) => CanvasNode,
): CanvasNode[] {
  return nodes.map((node) => (node.id === id ? updater(node) : node))
}

function updateChatData(node: CanvasNode, updater: (data: ChatNodeData) => ChatNodeData): CanvasNode {
  if (node.data.kind !== 'chat') return node
  return { ...node, data: updater(node.data) }
}

function updateDocumentData(
  node: CanvasNode,
  updater: (data: DocumentNodeData) => DocumentNodeData,
): CanvasNode {
  if (node.data.kind !== 'document') return node
  return { ...node, data: updater(node.data) }
}

function updateWebData(
  node: CanvasNode,
  updater: (data: WebNodeData) => WebNodeData,
): CanvasNode {
  if (node.data.kind !== 'web') return node
  return { ...node, data: updater(node.data) }
}

function makeChatNode(
  position: XYPosition,
  title: string,
  parentId?: string,
  source?: SourceAnchor,
): CanvasNode {
  return {
    id: createId('chat'),
    type: 'chat',
    position,
    width: NODE_SIZES.chat.width,
    height: NODE_SIZES.chat.height,
    dragHandle: '.node-drag-handle',
    data: {
      kind: 'chat',
      title,
      parentId,
      source,
      messages: [],
      status: 'idle',
    },
  }
}

function recoverInterruptedChat(node: CanvasNode): CanvasNode {
  if (node.data.kind !== 'chat' || node.data.status !== 'streaming') return node
  return {
    ...node,
    data: {
      ...node.data,
      status: 'error',
      error: '上次回答在页面关闭时中断。',
      messages: node.data.messages.map((message, index, entries) =>
        message.role === 'assistant' && index === entries.length - 1
          ? { ...message, incomplete: true }
          : message,
      ),
    },
  }
}

function recoverInterruptedOcr(node: CanvasNode): CanvasNode {
  if (node.data.kind !== 'document' || node.data.ocrStatus !== 'running') return node
  const pages = (node.data.ocrPages ?? []).map((page) =>
    page.status === 'pending' || page.status === 'processing'
      ? { ...page, status: 'error' as const, error: '页面刷新后识别中断。' }
      : page,
  )
  const done = pages.some((page) => page.status === 'done')
  return {
    ...node,
    data: {
      ...node.data,
      ocrPages: pages,
      ocrStatus: done ? 'partial' : 'error',
      ocrError: '上次 OCR 在页面刷新时中断，可重试未完成的页面。',
    },
  }
}

function recoverWebNode(node: CanvasNode): CanvasNode {
  if (node.data.kind !== 'web') return node
  const data = node.data
  const interrupted = data.mirrorState === 'answering' || data.mirrorState === 'submitting'
  const hadBinding = data.bindingState === 'bound' || data.bindingState === 'opening'
  return {
    ...node,
    data: {
      ...data,
      runtimeTabId: undefined,
      bindingState: hadBinding ? 'tab-closed' : data.bindingState,
      syncMode: data.syncMode === 'dom-mirror' ? 'linked-tab' : data.syncMode,
      mirrorState:
        hadBinding || interrupted
          ? (data.visibleMessages?.length ?? 0) > 0
            ? 'stale'
            : 'unavailable'
          : data.mirrorState,
      mirrorError:
        hadBinding || interrupted
          ? '页面刷新后需重新连接网页标签页，再核对最新消息。'
          : data.mirrorError,
      pendingRequestId: undefined,
      visibleMessages: data.visibleMessages ?? [],
    },
  }
}

function sanitizeNodeForStorage(node: CanvasNode): CanvasNode {
  const sanitized = recoverWebNode({ ...node, selected: false })
  return sanitized
}

function sanitizeSnapshotNode(node: CanvasNode): CanvasNode {
  return recoverWebNode(recoverInterruptedOcr(recoverInterruptedChat({ ...node, selected: false })))
}

function sanitizeSnapshotNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map(sanitizeSnapshotNode)
}

function stopStreamingNodes(nodes: CanvasNode[]) {
  for (const node of nodes) {
    if (node.data.kind === 'chat' && node.data.status === 'streaming') stopRequest(node.id)
  }
}

function makeSnapshot(state: Pick<CanvasState, 'nodes' | 'viewport' | 'canvasTitle'>): CanvasSnapshot {
  return {
    title: state.canvasTitle,
    viewport: state.viewport,
    nodes: sanitizeSnapshotNodes(state.nodes),
  }
}

function nextCanvasTitle(canvases: CanvasSummary[]): string {
  let index = canvases.length + 1
  while (canvases.some((canvas) => canvas.title === `画布 ${index}`)) index += 1
  return `画布 ${index}`
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      activeCanvasId: initialCanvasId,
      canvases: [{ id: initialCanvasId, title: '未命名画布' }],
      canvasSnapshots: {},
      nodes: [],
      viewport: initialViewport,
      canvasTitle: '未命名画布',
      apiConfig: DEFAULT_API_CONFIG,
      ocrConfig: DEFAULT_OCR_CONFIG,
      searchConfig: DEFAULT_SEARCH_CONFIG,
      contentFontSize: 14,
      sidebarCollapsed: false,
      selectedNodeId: null,
      focusedNodeId: null,
      pendingInputNodeId: null,
      revealNodeId: null,
      sourceJump: null,
      settingsOpen: false,
      settingsSection: 'model',

      onNodesChange: (changes) => {
        set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) }))
      },
      setNodes: (nodes) => set({ nodes }),
      setViewport: (viewport) => set({ viewport }),
      setCanvasTitle: (canvasTitle) =>
        set((state) => ({
          canvasTitle,
          canvases: state.canvases.map((canvas) =>
            canvas.id === state.activeCanvasId ? { ...canvas, title: canvasTitle } : canvas,
          ),
        })),

      createCanvas: () => {
        const state = get()
        stopStreamingNodes(state.nodes)
        const title = nextCanvasTitle(state.canvases)
        const id = createId('canvas')
        set({
          activeCanvasId: id,
          canvases: [
            ...state.canvases.map((canvas) =>
              canvas.id === state.activeCanvasId
                ? { ...canvas, title: state.canvasTitle }
                : canvas,
            ),
            { id, title },
          ],
          canvasSnapshots: {
            ...state.canvasSnapshots,
            [state.activeCanvasId]: makeSnapshot(state),
          },
          canvasTitle: title,
          nodes: [],
          viewport: initialViewport,
          selectedNodeId: null,
          focusedNodeId: null,
          pendingInputNodeId: null,
          revealNodeId: null,
          sourceJump: null,
        })
        return id
      },

      switchCanvas: (id) => {
        const state = get()
        if (id === state.activeCanvasId) return
        const target = state.canvasSnapshots[id]
        if (!target) return
        stopStreamingNodes(state.nodes)
        const canvasSnapshots = {
          ...state.canvasSnapshots,
          [state.activeCanvasId]: makeSnapshot(state),
        }
        delete canvasSnapshots[id]
        const canvases = state.canvases.map((canvas) =>
          canvas.id === state.activeCanvasId
            ? { ...canvas, title: state.canvasTitle }
            : canvas.id === id
              ? { ...canvas, title: target.title }
              : canvas,
        )
        set({
          activeCanvasId: id,
          canvases: canvases.some((canvas) => canvas.id === id)
            ? canvases
            : [...canvases, { id, title: target.title }],
          canvasSnapshots,
          canvasTitle: target.title,
          nodes: target.nodes,
          viewport: target.viewport,
          selectedNodeId: null,
          focusedNodeId: null,
          pendingInputNodeId: null,
          revealNodeId: null,
          sourceJump: null,
        })
      },

      deleteCanvas: (id) => {
        const state = get()
        if (state.canvases.length <= 1) return
        const remaining = state.canvases.filter((canvas) => canvas.id !== id)
        const canvasSnapshots = { ...state.canvasSnapshots }
        delete canvasSnapshots[id]

        if (id !== state.activeCanvasId) {
          set({ canvases: remaining, canvasSnapshots })
          return
        }

        stopStreamingNodes(state.nodes)
        const ordered = [...remaining].sort(
          (left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)),
        )
        const target = ordered[0]
        const targetSnapshot = canvasSnapshots[target.id]
        delete canvasSnapshots[target.id]
        set({
          canvases: remaining,
          canvasSnapshots,
          activeCanvasId: target.id,
          canvasTitle: targetSnapshot?.title ?? target.title,
          nodes: targetSnapshot?.nodes ?? [],
          viewport: targetSnapshot?.viewport ?? initialViewport,
          selectedNodeId: null,
          focusedNodeId: null,
          pendingInputNodeId: null,
          revealNodeId: null,
          sourceJump: null,
        })
      },

      toggleCanvasPin: (id) => {
        set((state) => ({
          canvases: state.canvases.map((canvas) =>
            canvas.id === id ? { ...canvas, pinned: !canvas.pinned } : canvas,
          ),
        }))
      },

      reorderCanvas: (sourceId, targetId) => {
        if (sourceId === targetId) return
        set((state) => {
          const source = state.canvases.find((canvas) => canvas.id === sourceId)
          const target = state.canvases.find((canvas) => canvas.id === targetId)
          if (!source || !target || Boolean(source.pinned) !== Boolean(target.pinned)) return state
          const ordered = [...state.canvases].sort(
            (left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)),
          )
          const from = ordered.findIndex((canvas) => canvas.id === sourceId)
          const to = ordered.findIndex((canvas) => canvas.id === targetId)
          if (from < 0 || to < 0) return state
          const [moved] = ordered.splice(from, 1)
          ordered.splice(to, 0, moved)
          return { canvases: ordered }
        })
      },

      setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
      setFocusedNodeId: (focusedNodeId) => set({ focusedNodeId }),
      setRevealNodeId: (revealNodeId) => set({ revealNodeId }),
      setRevealHandled: () => set({ revealNodeId: null }),
      setPendingInputHandled: () => set({ pendingInputNodeId: null }),
      setApiConfig: (apiConfig) => set({ apiConfig }),
      setOcrConfig: (ocrConfig) => set({ ocrConfig }),
      setSearchConfig: (searchConfig) => set({ searchConfig }),
      setContentFontSize: (contentFontSize) =>
        set({ contentFontSize: Math.min(20, Math.max(12, Math.round(contentFontSize))) }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      openSettings: (section = 'model') => set({ settingsOpen: true, settingsSection: section }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setSettingsSection: (settingsSection) => set({ settingsSection }),

      updateNodeData: (id, updater) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) => ({ ...node, data: updater(node.data) })),
        }))
      },

      setNodeTitle: (id, title) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) => ({
            ...node,
            data: { ...node.data, title: title.trim() || '未命名节点' },
          })),
        }))
      },

      addChatNode: (position, parentId, source) => {
        const state = get()
        const title = source ? `追问：${source.quote.slice(0, 22)}` : '新对话'
        const size = NODE_SIZES.chat
        const free = findFreePosition(state.nodes, position, size)
        const node = { ...makeChatNode(free, title, parentId, source), selected: true }
        set({
          nodes: [...state.nodes.map((entry) => ({ ...entry, selected: false })), node],
          selectedNodeId: node.id,
          focusedNodeId: null,
          pendingInputNodeId: node.id,
          revealNodeId: node.id,
        })
        return node.id
      },

      addDocumentNode: (initial, position) => {
        const state = get()
        const size = NODE_SIZES.document
        const free = findFreePosition(state.nodes, position, size)
        const id = createId('doc')
        const node: CanvasNode = {
          id,
          type: 'document',
          position: free,
          width: size.width,
          height: size.height,
          dragHandle: '.node-drag-handle',
          data: {
            kind: 'document',
            title: initial.title,
            fileName: initial.fileName,
            fileType: initial.fileType,
            text: '',
            currentPage: 1,
            status: 'loading',
          },
        }
        set({
          nodes: [...state.nodes.map((entry) => ({ ...entry, selected: false })), { ...node, selected: true }],
          selectedNodeId: id,
          focusedNodeId: null,
          revealNodeId: id,
        })
        return id
      },

      addWebNode: (providerId, position) => {
        const state = get()
        const provider = WEB_PROVIDERS[providerId]
        const size = NODE_SIZES.web
        const free = findFreePosition(state.nodes, position, size)
        const id = createId('web')
        const node: CanvasNode = {
          id,
          type: 'web',
          position: free,
          width: size.width,
          height: size.height,
          dragHandle: '.node-drag-handle',
          data: {
            kind: 'web',
            title: provider.label,
            providerId,
            conversationUrl: provider.homeUrl,
            bindingState: 'unbound',
            syncMode: 'shortcut',
            mirrorState: 'unavailable',
            visibleMessages: [],
          },
        }
        set({
          nodes: [...state.nodes.map((entry) => ({ ...entry, selected: false })), { ...node, selected: true }],
          selectedNodeId: id,
          focusedNodeId: null,
          revealNodeId: id,
        })
        return id
      },

      updateWebNodeData: (id, updater) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) => updateWebData(node, updater)),
        }))
      },

      finishDocumentImport: (id, data) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateDocumentData(node, (documentData) => ({ ...documentData, ...data, status: 'ready' })),
          ),
        }))
      },

      failDocumentImport: (id, error) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateDocumentData(node, (documentData) => ({
              ...documentData,
              status: 'error',
              error,
            })),
          ),
        }))
      },

      setDocumentPage: (id, page) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateDocumentData(node, (documentData) => ({
              ...documentData,
              currentPage: Math.max(1, Math.min(documentData.pageCount ?? page, page)),
            })),
          ),
        }))
      },

      setDocumentView: (id, view) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateDocumentData(node, (documentData) => ({
              ...documentData,
              viewMode: view,
            })),
          ),
        }))
      },

      beginOcrRun: (id, pages, model) => {
        const targets = [...new Set(pages)].filter((page) => Number.isInteger(page) && page > 0)
        if (!targets.length) return
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateDocumentData(node, (documentData) => {
              const existing = new Map((documentData.ocrPages ?? []).map((page) => [page.number, page]))
              for (const page of targets) {
                const current = existing.get(page)
                if (current?.status === 'done') continue
                existing.set(page, { number: page, text: '', status: 'pending' })
              }
              return {
                ...documentData,
                ocrPages: [...existing.values()].sort((left, right) => left.number - right.number),
                ocrStatus: 'running',
                ocrError: undefined,
                ocrModel: model,
                viewMode:
                  documentData.fileType === 'pdf' && !documentData.text.trim()
                    ? 'ocr'
                    : documentData.viewMode,
              }
            }),
          ),
        }))
      },

      updateOcrPage: (id, page, update) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateDocumentData(node, (documentData) => {
              const pages = documentData.ocrPages ?? []
              const existing = pages.some((entry) => entry.number === page)
              const next = existing
                ? pages.map((entry) =>
                    entry.number === page
                      ? { ...entry, ...update, number: page }
                      : entry,
                  )
                : [...pages, { number: page, text: '', status: 'pending' as const, ...update }]
              return {
                ...documentData,
                ocrPages: next.sort((left, right) => left.number - right.number),
              }
            }),
          ),
        }))
      },

      finishOcrRun: (id, error) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateDocumentData(node, (documentData) => {
              const pages = documentData.ocrPages ?? []
              const done = pages.filter((page) => page.status === 'done').length
              const pending = pages.filter(
                (page) => page.status === 'pending' || page.status === 'processing',
              ).length
              const failed = pages.filter((page) => page.status === 'error').length
              let status: OcrRunStatus
              if (error) status = 'error'
              else if (pending) status = 'running'
              else if (done && failed) status = 'partial'
              else if (done) status = 'done'
              else if (failed) status = 'error'
              else status = 'idle'
              return {
                ...documentData,
                ocrStatus: status,
                ocrError:
                  error ??
                  (failed && done
                    ? `${failed} 页识别失败，可单独重试。`
                    : failed
                      ? 'OCR 没有成功识别任何页面。'
                      : undefined),
              }
            }),
          ),
        }))
      },

      createBranch: (parentId, source) => {
        const state = get()
        const parent = state.nodes.find((node) => node.id === parentId)
        if (!parent) return null
        const position = findBranchPosition(state.nodes, parent)
        const node = makeChatNode(
          position,
          `追问：${source.quote.slice(0, 22)}`,
          parentId,
          {
            ...source,
            parentNodeId: parent.id,
            parentTitle: parent.data.title,
          },
        )
        set({
          nodes: [...state.nodes.map((entry) => ({ ...entry, selected: false })), { ...node, selected: true }],
          selectedNodeId: node.id,
          focusedNodeId: null,
          pendingInputNodeId: node.id,
          revealNodeId: node.id,
        })
        return node.id
      },

      removeNode: (id) => {
        const state = get()
        const node = state.nodes.find((entry) => entry.id === id)
        if (!node) return

        if (node.data.kind === 'document' && node.data.assetId) {
          void removePdfAsset(node.data.assetId)
        }

        const frozenContext = snapshotContextForFrozenBranch(state.nodes, id)
        const remaining = state.nodes
          .filter((entry) => entry.id !== id)
          .map((entry) => {
            if (entry.data.parentId !== id) return entry
            const nextData: CanvasNodeData = {
              ...entry.data,
              parentId: undefined,
              source: entry.data.source
                ? { ...entry.data.source, frozen: true, frozenContext }
                : undefined,
            }
            return { ...entry, data: nextData }
          })

        set({
          nodes: remaining,
          selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
          focusedNodeId: state.focusedNodeId === id ? null : state.focusedNodeId,
        })
      },

      setChatError: (id, error) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateChatData(node, (data) => ({ ...data, status: 'error', error })),
          ),
        }))
      },

      rewindToLastUser: (id) => {
        const node = get().nodes.find((entry) => entry.id === id)
        if (!node || node.data.kind !== 'chat') return null
        const index = [...node.data.messages].map((message) => message.role).lastIndexOf('user')
        if (index < 0) return null
        const prompt = node.data.messages[index].content
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (entry) =>
            updateChatData(entry, (data) => ({
              ...data,
              messages: data.messages.slice(0, index),
              status: 'idle',
              error: undefined,
            })),
          ),
        }))
        return prompt
      },

      rewindToMessage: (id, messageId) => {
        const node = get().nodes.find((entry) => entry.id === id)
        if (!node || node.data.kind !== 'chat') return null
        let index = node.data.messages.findIndex((message) => message.id === messageId)
        if (index < 0) return null
        if (node.data.messages[index].role !== 'user') {
          index = node.data.messages
            .slice(0, index + 1)
            .map((message) => message.role)
            .lastIndexOf('user')
        }
        if (index < 0) return null
        const prompt = node.data.messages[index].content
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (entry) =>
            updateChatData(entry, (data) => ({
              ...data,
              messages: data.messages.slice(0, index),
              status: 'idle',
              error: undefined,
            })),
          ),
        }))
        return prompt
      },

      startExchange: (id, userText, assistantId, model, contextNote) => {
        const now = Date.now()
        const userMessage: ChatMessage = {
          id: createId('msg'),
          role: 'user',
          content: userText,
          createdAt: now,
        }
        const assistantMessage: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: now,
          model,
        }
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateChatData(node, (data) => ({
              ...data,
              title:
                data.title === '新对话' || data.title.startsWith('追问：')
                  ? userText.trim().slice(0, 34) || data.title
                  : data.title,
              messages: [...data.messages, userMessage, assistantMessage],
              status: 'streaming',
              error: undefined,
              model,
              contextNote,
            })),
          ),
        }))
      },

      appendAssistantDelta: (id, assistantId, delta) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateChatData(node, (data) => ({
              ...data,
              messages: data.messages.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + delta }
                  : message,
              ),
            })),
          ),
        }))
      },

      finishAssistant: (id, assistantId) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateChatData(node, (data) => ({
              ...data,
              status: 'idle',
              error: undefined,
              messages: data.messages.map((message) =>
                message.id === assistantId ? { ...message, incomplete: false } : message,
              ),
            })),
          ),
        }))
      },

      failAssistant: (id, assistantId, error) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateChatData(node, (data) => {
              const target = data.messages.find((message) => message.id === assistantId)
              const hasText = Boolean(target?.content.trim())
              return {
                ...data,
                status: 'error',
                error,
                messages: hasText
                  ? data.messages.map((message) =>
                      message.id === assistantId ? { ...message, incomplete: true } : message,
                    )
                  : data.messages.filter((message) => message.id !== assistantId),
              }
            }),
          ),
        }))
      },

      stopAssistant: (id, assistantId) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateChatData(node, (data) => ({
              ...data,
              status: 'idle',
              messages: data.messages.map((message) =>
                message.id === assistantId
                  ? { ...message, incomplete: true }
                  : message,
              ),
            })),
          ),
        }))
      },

      setChatContextNote: (id, contextNote) => {
        set((state) => ({
          nodes: updateNodeById(state.nodes, id, (node) =>
            updateChatData(node, (data) => ({ ...data, contextNote })),
          ),
        }))
      },

      requestSourceJump: (request) => {
        set((state) => ({
          nodes: state.nodes.map((node) => ({
            ...node,
            selected: node.id === request.nodeId,
          })),
          sourceJump: { ...request, nonce: Date.now() },
          focusedNodeId: request.nodeId,
          selectedNodeId: request.nodeId,
        }))
      },

      clearSourceJump: () => set({ sourceJump: null }),
    }),
    {
      name: 'knowledge-canvas-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeCanvasId: state.activeCanvasId,
        canvases: state.canvases,
        canvasSnapshots: Object.fromEntries(
          Object.entries(state.canvasSnapshots).map(([id, snapshot]) => [
            id,
            { ...snapshot, nodes: sanitizeSnapshotNodes(snapshot.nodes) },
          ]),
        ),
        nodes: state.nodes.map(sanitizeNodeForStorage),
        viewport: state.viewport,
        canvasTitle: state.canvasTitle,
        apiConfig: state.apiConfig,
        ocrConfig: state.ocrConfig,
        searchConfig: state.searchConfig,
        contentFontSize: state.contentFontSize,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<CanvasState> | undefined
        const activeCanvasId =
          typeof saved?.activeCanvasId === 'string' && saved.activeCanvasId
            ? saved.activeCanvasId
            : createId('canvas')
        const rawCanvases = Array.isArray(saved?.canvases)
          ? saved.canvases.filter(
              (canvas): canvas is CanvasSummary =>
                Boolean(canvas && typeof canvas.id === 'string' && typeof canvas.title === 'string'),
            )
          : []
        let canvases = rawCanvases.length
          ? rawCanvases
          : [{ id: activeCanvasId, title: saved?.canvasTitle || '未命名画布' }]
        canvases = canvases.map((canvas) =>
          canvas.id === activeCanvasId
            ? { ...canvas, title: saved?.canvasTitle || canvas.title || '未命名画布' }
            : canvas,
        )

        const canvasSnapshots: Record<string, CanvasSnapshot> = {}
        const savedSnapshots =
          saved?.canvasSnapshots && typeof saved.canvasSnapshots === 'object'
            ? saved.canvasSnapshots
            : {}
        for (const [id, snapshot] of Object.entries(savedSnapshots)) {
          if (id === activeCanvasId) continue
          if (!snapshot || !Array.isArray(snapshot.nodes)) continue
          canvasSnapshots[id] = {
            title: typeof snapshot.title === 'string' ? snapshot.title : '未命名画布',
            viewport: snapshot.viewport ?? initialViewport,
            nodes: sanitizeSnapshotNodes(snapshot.nodes),
          }
        }
        for (const [id, snapshot] of Object.entries(canvasSnapshots)) {
          if (!canvases.some((canvas) => canvas.id === id)) {
            canvases.push({ id, title: snapshot.title })
          }
        }
        if (!canvases.some((canvas) => canvas.id === activeCanvasId)) {
          canvases = [{ id: activeCanvasId, title: saved?.canvasTitle || '未命名画布' }, ...canvases]
        }

        return {
          ...current,
          ...saved,
          activeCanvasId,
          canvases,
          canvasSnapshots,
          canvasTitle: saved?.canvasTitle ?? current.canvasTitle,
          viewport: saved?.viewport ?? current.viewport,
          apiConfig: { ...current.apiConfig, ...saved?.apiConfig },
          ocrConfig: { ...current.ocrConfig, ...saved?.ocrConfig },
          searchConfig: { ...current.searchConfig, ...saved?.searchConfig },
          sidebarCollapsed:
            typeof saved?.sidebarCollapsed === 'boolean'
              ? saved.sidebarCollapsed
              : current.sidebarCollapsed,
          contentFontSize:
            typeof saved?.contentFontSize === 'number' ? saved.contentFontSize : current.contentFontSize,
          nodes: (saved?.nodes ?? [])
            .map(recoverInterruptedChat)
            .map(recoverInterruptedOcr)
            .map(recoverWebNode),
          focusedNodeId: null,
          selectedNodeId: null,
          pendingInputNodeId: null,
          revealNodeId: null,
          sourceJump: null,
          settingsOpen: false,
          settingsSection: 'model',
        }
      },
    },
  ),
)


