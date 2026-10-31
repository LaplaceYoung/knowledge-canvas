import type { WebBindingState, WebMirrorState, WebProviderId, WebSyncMode } from '@/types/canvas'
import type { WebControl, WebMessage } from '@/types/canvas'
import { WEB_EXTENSION_ID } from '@/lib/web-providers'

export interface BridgeBinding {
  nodeId: string
  providerId: WebProviderId
  tabId: number
  title: string
  conversationUrl: string
  mirror: boolean
  mirrorArmed: boolean
  adapterVersion?: string
  bindingState: Extract<WebBindingState, 'bound'>
  syncMode: Extract<WebSyncMode, 'linked-tab' | 'dom-mirror'>
}

export interface BridgeBindingInfo {
  bindingState: Extract<WebBindingState, 'unbound' | 'tab-closed'>
  conversationUrl?: string
}

export interface BridgeTranscript {
  title: string
  conversationUrl: string
  messages: WebMessage[]
  mirror: boolean
}

export interface BridgeControls {
  provider: WebProviderId
  title: string
  conversationUrl: string
  controls: WebControl[]
}

export type BridgeEvent = { type: 'bridge.ready'; version: string } | { type: 'bridge.disconnected' } | {
  type: 'binding.updated'
  nodeId: string
  binding: BridgeBinding
} | {
  type: 'mirror.update'
  nodeId: string
  requestId: string
  state: Extract<WebMirrorState, 'answering' | 'ready' | 'needs-login' | 'stale' | 'unknown' | 'error'>
  messages: WebMessage[]
  conversationUrl?: string
  pageTitle?: string
  error?: string
} | { type: 'tab.closed'; nodeId: string } | {
  type: 'web.changed'
  nodeId: string
  conversationUrl?: string
} | { type: 'error'; nodeId?: string; message: string }

interface ChromePort {
  postMessage: (message: unknown) => void
  onMessage: { addListener: (listener: (message: unknown) => void) => void }
  onDisconnect: { addListener: (listener: () => void) => void }
  disconnect: () => void
}

interface ChromeRuntime {
  lastError?: { message?: string }
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback?: (response: unknown) => void,
  ) => void
  connect: (extensionId: string, options: { name: string }) => ChromePort
}

interface ChromeWindow extends Window {
  chrome?: { runtime?: ChromeRuntime }
}

interface BridgeResponse<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}

export class WebBridgeError extends Error {
  code: string

  constructor(message: string, code = 'BRIDGE_ERROR') {
    super(message)
    this.name = 'WebBridgeError'
    this.code = code
  }
}

function getChromeRuntime(): ChromeRuntime | undefined {
  return (window as ChromeWindow).chrome?.runtime
}

export function isChromeRuntimePresent(): boolean {
  return Boolean(getChromeRuntime()?.sendMessage)
}

export function webBridgeUnavailableMessage(): string {
  return '未检测到 Knowledge Canvas Bridge 扩展。当前 Web 节点只能作为网页快捷入口。'
}

export async function sendWebBridgeCommand<T>(
  message: Record<string, unknown>,
  timeoutMs = 3_000,
): Promise<T> {
  const runtime = getChromeRuntime()
  if (!runtime?.sendMessage) {
    throw new WebBridgeError(webBridgeUnavailableMessage(), 'EXTENSION_MISSING')
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new WebBridgeError('扩展没有响应，操作结果未知。', 'BRIDGE_TIMEOUT'))
    }, timeoutMs)

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      callback()
    }

    try {
      runtime.sendMessage(WEB_EXTENSION_ID, message, (response) => {
        const lastError = runtime.lastError?.message
        finish(() => {
          if (lastError) {
            reject(new WebBridgeError(lastError, 'BRIDGE_DISCONNECTED'))
            return
          }
          const payload = response as BridgeResponse<T> | undefined
          if (!payload) {
            reject(new WebBridgeError('扩展没有返回结果。', 'EMPTY_RESPONSE'))
            return
          }
          if (!payload.ok) {
            reject(
              new WebBridgeError(
                payload.error?.message || '扩展拒绝了请求。',
                payload.error?.code || 'BRIDGE_REJECTED',
              ),
            )
            return
          }
          resolve(payload.data as T)
        })
      })
    } catch (error) {
      finish(() =>
        reject(
          new WebBridgeError(
            error instanceof Error ? error.message : '无法连接扩展。',
            'BRIDGE_DISCONNECTED',
          ),
        ),
      )
    }
  })
}

export async function pingWebBridge(): Promise<{ version: string } | null> {
  try {
    const data = await sendWebBridgeCommand<{ version: string }>({ type: 'ping' }, 1_500)
    return data
  } catch {
    return null
  }
}

export function listenWebBridgeEvents(handler: (event: BridgeEvent) => void): () => void {
  const runtime = getChromeRuntime()
  if (!runtime?.connect) return () => undefined

  let disposed = false
  let everConnected = false
  let reconnectTimer: number | undefined
  let port: ChromePort | undefined

  const connect = () => {
    if (disposed) return
    try {
      port = runtime.connect(WEB_EXTENSION_ID, { name: 'knowledge-canvas' })
    } catch {
      port = undefined
      return
    }

    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return
      const event = message as BridgeEvent
      if (event.type === 'bridge.ready') everConnected = true
      handler(event)
    }
    const onDisconnect = () => {
      handler({ type: 'bridge.disconnected' })
      port = undefined
      if (disposed || !everConnected) return
      window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(connect, 1_500)
    }
    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
  }

  connect()

  return () => {
    disposed = true
    window.clearTimeout(reconnectTimer)
    try {
      port?.disconnect()
    } catch {
      // The extension may already be gone.
    }
  }
}
