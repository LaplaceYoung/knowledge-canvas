import type { Node, Viewport } from '@xyflow/react'

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  model?: string
  incomplete?: boolean
}

export type TextLayer = 'page' | 'ocr'

export interface SourceAnchor {
  parentNodeId: string
  parentMessageId?: string
  quote: string
  page?: number
  view?: TextLayer
  parentTitle: string
  frozen?: boolean
  frozenContext?: string
}

export interface ChatNodeData extends Record<string, unknown> {
  kind: 'chat'
  title: string
  parentId?: string
  source?: SourceAnchor
  messages: ChatMessage[]
  status: 'idle' | 'streaming' | 'error'
  error?: string
  model?: string
  contextNote?: string
}

export interface DocumentPage {
  number: number
  text: string
}

export type OcrProvider = 'paddle-cloud' | 'self-hosted'
export type OcrRunStatus = 'idle' | 'running' | 'done' | 'partial' | 'error'
export type OcrPageStatus = 'pending' | 'processing' | 'done' | 'error'

export interface OcrPage {
  number: number
  text: string
  status: OcrPageStatus
  error?: string
}

export interface OcrConfig {
  provider: OcrProvider
  model: string
  endpoint: string
  autoRun: boolean
}

export type WebProviderId =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'grok'
  | 'deepseek'
  | 'doubao'
  | 'qwen'
  | 'kimi'
export type WebBindingState =
  | 'unbound'
  | 'opening'
  | 'bound'
  | 'tab-closed'
  | 'extension-missing'
  | 'permission-required'
  | 'error'
export type WebSyncMode = 'shortcut' | 'linked-tab' | 'dom-mirror'
export type WebMirrorState =
  | 'unavailable'
  | 'ready'
  | 'submitting'
  | 'answering'
  | 'needs-login'
  | 'stale'
  | 'unknown'
  | 'error'

export interface WebMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export interface WebControlOption {
  value: string
  label: string
}

export interface WebControl {
  id: string
  label: string
  type: 'select' | 'toggle'
  value: string | boolean
  options?: WebControlOption[]
}

export interface WebNodeData extends Record<string, unknown> {
  kind: 'web'
  title: string
  parentId?: string
  source?: SourceAnchor
  providerId: WebProviderId
  conversationUrl?: string
  runtimeTabId?: number
  bindingState: WebBindingState
  syncMode: WebSyncMode
  mirrorState: WebMirrorState
  mirrorError?: string
  visibleMessages: WebMessage[]
  adapterVersion?: string
  lastSyncedAt?: number
  lastOpenedAt?: number
  pageTitle?: string
  pendingRequestId?: string
  draft?: string
  controls?: WebControl[]
  controlsError?: string
  controlsUpdatedAt?: number
}

export interface DocumentNodeData extends Record<string, unknown> {
  kind: 'document'
  title: string
  parentId?: string
  source?: SourceAnchor
  fileType: 'pdf' | 'markdown' | 'text'
  fileName: string
  text: string
  pages?: DocumentPage[]
  pageCount?: number
  currentPage: number
  assetId?: string
  status: 'loading' | 'ready' | 'error'
  error?: string
  ocrPages?: OcrPage[]
  ocrStatus?: OcrRunStatus
  ocrError?: string
  ocrModel?: string
  viewMode?: TextLayer
}

export type CanvasNodeData = ChatNodeData | DocumentNodeData | WebNodeData
export type CanvasNode = Node<CanvasNodeData, 'chat' | 'document' | 'web'>

export interface ApiConfig {
  baseUrl: string
  model: string
  providerLabel: string
}

export type SettingsSection = 'model' | 'ocr' | 'agent' | 'display'

export interface CanvasViewport extends Viewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasSummary {
  id: string
  title: string
}

export interface CanvasSnapshot {
  title: string
  viewport: CanvasViewport
  nodes: CanvasNode[]
}

export interface SourceJumpRequest {
  nodeId: string
  messageId?: string
  page?: number
  quote?: string
  view?: TextLayer
  nonce: number
}

export const NODE_SIZES = {
  chat: { width: 480, height: 560, minWidth: 320, minHeight: 280 },
  document: { width: 640, height: 720, minWidth: 380, minHeight: 360 },
  web: { width: 520, height: 560, minWidth: 360, minHeight: 320 },
} as const

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  providerLabel: 'OpenAI-compatible',
}

export const DEFAULT_OCR_CONFIG: OcrConfig = {
  provider: 'paddle-cloud',
  model: 'PP-OCRv6',
  endpoint: 'http://127.0.0.1:8080/ocr',
  autoRun: false,
}
