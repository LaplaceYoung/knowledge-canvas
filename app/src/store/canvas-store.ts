import { applyNodeChanges, type NodeChange, type XYPosition } from '@xyflow/react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createId } from '@/lib/id'
import { findBranchPosition, findFreePosition } from '@/lib/layout'
import { removePdfAsset } from '@/lib/files'
import { snapshotContextForFrozenBranch } from '@/lib/context'
import type {
  ApiConfig,
  CanvasNode,
  CanvasNodeData,
  CanvasViewport,
  ChatMessage,
  ChatNodeData,
  DocumentNodeData,
  OcrConfig,
  OcrPage,
  OcrRunStatus,
  SettingsSection,
  SourceAnchor,
  SourceJumpRequest,
  TextLayer,
} from '@/types/canvas'
import { DEFAULT_API_CONFIG, DEFAULT_OCR_CONFIG, NODE_SIZES } from '@/types/canvas'

const initialViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }

interface CanvasState {
  nodes: CanvasNode[]
  viewport: CanvasViewport
  canvasTitle: string
  apiConfig: ApiConfig
  ocrConfig: OcrConfig
  contentFontSize: number
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
  setSelectedNodeId: (id: string | null) => void
  setFocusedNodeId: (id: string | null) => void
  setRevealNodeId: (id: string | null) => void
  setRevealHandled: () => void
  setPendingInputHandled: () => void
  setApiConfig: (config: ApiConfig) => void
  setOcrConfig: (config: OcrConfig) => void
  setContentFontSize: (size: number) => void
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

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      nodes: [],
      viewport: initialViewport,
      canvasTitle: '未命名画布',
      apiConfig: DEFAULT_API_CONFIG,
      ocrConfig: DEFAULT_OCR_CONFIG,
      contentFontSize: 14,
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
      setCanvasTitle: (canvasTitle) => set({ canvasTitle }),
      setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
      setFocusedNodeId: (focusedNodeId) => set({ focusedNodeId }),
      setRevealNodeId: (revealNodeId) => set({ revealNodeId }),
      setRevealHandled: () => set({ revealNodeId: null }),
      setPendingInputHandled: () => set({ pendingInputNodeId: null }),
      setApiConfig: (apiConfig) => set({ apiConfig }),
      setOcrConfig: (ocrConfig) => set({ ocrConfig }),
      setContentFontSize: (contentFontSize) =>
        set({ contentFontSize: Math.min(20, Math.max(12, Math.round(contentFontSize))) }),
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
        nodes: state.nodes.map((node) => ({ ...node, selected: false })),
        viewport: state.viewport,
        canvasTitle: state.canvasTitle,
        apiConfig: state.apiConfig,
        ocrConfig: state.ocrConfig,
        contentFontSize: state.contentFontSize,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<CanvasState> | undefined
        return {
          ...current,
          ...saved,
          apiConfig: { ...current.apiConfig, ...saved?.apiConfig },
          ocrConfig: { ...current.ocrConfig, ...saved?.ocrConfig },
          contentFontSize:
            typeof saved?.contentFontSize === 'number' ? saved.contentFontSize : current.contentFontSize,
          nodes: (saved?.nodes ?? []).map(recoverInterruptedChat).map(recoverInterruptedOcr),
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


