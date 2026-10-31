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

export type CanvasNodeData = ChatNodeData | DocumentNodeData
export type CanvasNode = Node<CanvasNodeData, 'chat' | 'document'>

export interface ApiConfig {
  baseUrl: string
  model: string
  providerLabel: string
}

export type SettingsSection = 'model' | 'ocr' | 'display'

export interface CanvasViewport extends Viewport {
  x: number
  y: number
  zoom: number
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
