import { createId } from '@/lib/id'
import { useCanvasStore } from '@/store/canvas-store'
import type {
  BridgeBinding,
  BridgeBindingInfo,
  BridgeControls,
  BridgeEvent,
  BridgeTranscript,
} from '@/lib/web-bridge'
import {
  pingWebBridge,
  sendWebBridgeCommand,
  WebBridgeError,
  webBridgeUnavailableMessage,
} from '@/lib/web-bridge'
import { getWebProvider } from '@/lib/web-providers'
import type { CanvasNode, WebMessage, WebNodeData } from '@/types/canvas'

export interface WebActionResult {
  ok: boolean
  error?: string
  unknown?: boolean
}

function getWebNode(nodeId: string): (CanvasNode & { data: WebNodeData }) | null {
  const node = useCanvasStore.getState().nodes.find((entry) => entry.id === nodeId)
  return node?.data.kind === 'web' ? (node as CanvasNode & { data: WebNodeData }) : null
}

function updateWeb(nodeId: string, updater: (data: WebNodeData) => WebNodeData) {
  useCanvasStore.getState().updateWebNodeData(nodeId, updater)
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Web 节点操作失败。'
}

function applyBinding(nodeId: string, binding: BridgeBinding) {
  updateWeb(nodeId, (data) => ({
    ...data,
    pageTitle: binding.title || data.pageTitle,
    conversationUrl: binding.conversationUrl || data.conversationUrl,
    runtimeTabId: binding.tabId,
    bindingState: 'bound',
    syncMode: binding.mirror ? 'dom-mirror' : 'linked-tab',
    mirrorState: binding.mirror ? 'ready' : 'unavailable',
    mirrorError: undefined,
    adapterVersion: binding.adapterVersion,
    lastOpenedAt: Date.now(),
  }))
}

function applyControls(nodeId: string, data: BridgeControls) {
  updateWeb(nodeId, (current) => ({
    ...current,
    controls: data.controls,
    controlsError: undefined,
    controlsUpdatedAt: Date.now(),
  }))
}

function applyShortcut(nodeId: string, error?: string) {
  updateWeb(nodeId, (data) => {
    const provider = getWebProvider(data.providerId)
    return {
      ...data,
      conversationUrl: data.conversationUrl || provider.homeUrl,
      runtimeTabId: undefined,
      bindingState: 'extension-missing',
      syncMode: 'shortcut',
      mirrorState: 'unavailable',
      mirrorError: error || webBridgeUnavailableMessage(),
      pendingRequestId: undefined,
    }
  })
}

function upsertMessages(existing: WebMessage[], incoming: WebMessage[]): WebMessage[] {
  const result = existing.slice()
  const indexById = new Map(result.map((message, index) => [message.id, index]))
  for (const message of incoming) {
    const index = indexById.get(message.id)
    if (index === undefined) {
      const duplicate = result.find(
        (entry) =>
          entry.role === message.role &&
          entry.content.trim() === message.content.trim() &&
          Math.abs(entry.createdAt - message.createdAt) < 120_000,
      )
      if (duplicate) continue
      indexById.set(message.id, result.length)
      result.push(message)
    } else {
      result[index] = { ...result[index], ...message }
    }
  }
  return result
}

export async function connectWebNode(nodeId: string) {
  const node = getWebNode(nodeId)
  if (!node) return
  const provider = getWebProvider(node.data.providerId)
  updateWeb(nodeId, (data) => ({
    ...data,
    bindingState: 'opening',
    mirrorError: undefined,
    conversationUrl: data.conversationUrl || provider.homeUrl,
  }))

  const ping = await pingWebBridge()
  if (!ping) {
    applyShortcut(nodeId)
    return
  }

  try {
    const binding = await sendWebBridgeCommand<BridgeBinding>(
      {
        type: 'web.create',
        nodeId,
        providerId: node.data.providerId,
      },
      12_000,
    )
    applyBinding(nodeId, binding)
    void refreshWebControls(nodeId)
  } catch (error) {
    const bridgeError = error instanceof WebBridgeError ? error : null
    if (bridgeError?.code === 'EXTENSION_MISSING' || bridgeError?.code === 'BRIDGE_DISCONNECTED') {
      applyShortcut(nodeId, errorMessage(error))
      return
    }
    updateWeb(nodeId, (data) => ({
      ...data,
      bindingState: 'error',
      mirrorError: errorMessage(error),
      mirrorState: 'error',
      pendingRequestId: undefined,
    }))
  }
}

export async function openWebNodePage(nodeId: string) {
  const node = getWebNode(nodeId)
  if (!node) return
  const provider = getWebProvider(node.data.providerId)
  const url = node.data.conversationUrl || provider.homeUrl

  if (
    node.data.bindingState === 'bound' ||
    node.data.bindingState === 'tab-closed' ||
    node.data.bindingState === 'opening'
  ) {
    try {
      const binding = await sendWebBridgeCommand<BridgeBinding>(
        {
          type: 'conversation.focus',
          nodeId,
          providerId: node.data.providerId,
          conversationUrl: url,
        },
        8_000,
      )
      applyBinding(nodeId, binding)
      return
    } catch {
      // Fall through to a normal tab when the extension cannot focus the original.
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer')
  updateWeb(nodeId, (data) => ({ ...data, lastOpenedAt: Date.now() }))
}

export async function bindCurrentWebNode(nodeId: string) {
  const node = getWebNode(nodeId)
  if (!node) return { ok: false, error: '节点不存在。' } satisfies WebActionResult
  updateWeb(nodeId, (data) => ({ ...data, bindingState: 'opening', mirrorError: undefined }))

  try {
    const binding = await sendWebBridgeCommand<BridgeBinding>(
      {
        type: 'conversation.bind',
        nodeId,
        providerId: node.data.providerId,
      },
      8_000,
    )
    applyBinding(nodeId, binding)
    void refreshWebControls(nodeId)
    return { ok: true } satisfies WebActionResult
  } catch (error) {
    const message = errorMessage(error)
    if (
      error instanceof WebBridgeError &&
      (error.code === 'EXTENSION_MISSING' || error.code === 'BRIDGE_DISCONNECTED')
    ) {
      applyShortcut(nodeId, message)
      return { ok: false, error: message } satisfies WebActionResult
    }
    updateWeb(nodeId, (data) => ({
      ...data,
      bindingState: data.bindingState === 'opening' ? 'error' : data.bindingState,
      mirrorError: message,
    }))
    return { ok: false, error: message } satisfies WebActionResult
  }
}

export async function unbindWebNode(nodeId: string) {
  try {
    await sendWebBridgeCommand({ type: 'conversation.unbind', nodeId }, 3_000)
  } catch {
    // Local unbinding must remain possible when the extension is gone.
  }
  updateWeb(nodeId, (data) => ({
    ...data,
    runtimeTabId: undefined,
    bindingState: data.conversationUrl ? 'unbound' : 'extension-missing',
    syncMode: 'shortcut',
    mirrorState: data.visibleMessages.length ? 'stale' : 'unavailable',
    mirrorError: data.visibleMessages.length
      ? '已解除绑定。重新绑定后请核对网页内容。'
      : undefined,
    pendingRequestId: undefined,
  }))
}

export async function syncWebNode(nodeId: string) {
  try {
    const transcript = await sendWebBridgeCommand<BridgeTranscript>(
      { type: 'transcript.getVisible', nodeId },
      15_000,
    )
    updateWeb(nodeId, (data) => ({
      ...data,
      visibleMessages: transcript.messages,
      pageTitle: transcript.title || data.pageTitle,
      conversationUrl: transcript.conversationUrl || data.conversationUrl,
      bindingState: 'bound',
      syncMode: 'dom-mirror',
      mirrorState: 'ready',
      mirrorError: undefined,
      lastSyncedAt: Date.now(),
    }))
    return { ok: true } satisfies WebActionResult
  } catch (error) {
    const message = errorMessage(error)
    updateWeb(nodeId, (data) => ({
      ...data,
      mirrorError: message,
      mirrorState: data.mirrorState === 'answering' ? 'unknown' : data.mirrorState,
    }))
    return { ok: false, error: message } satisfies WebActionResult
  }
}

export async function submitWebPrompt(nodeId: string, text: string) {
  const prompt = text.trim()
  if (!prompt) return { ok: false, error: '输入内容为空。' } satisfies WebActionResult
  const node = getWebNode(nodeId)
  if (!node) return { ok: false, error: '节点不存在。' } satisfies WebActionResult
  if (node.data.bindingState !== 'bound') {
    return { ok: false, error: '当前节点还没有连接网页标签页。' } satisfies WebActionResult
  }
  if (node.data.pendingRequestId) {
    return { ok: false, error: '上一轮网页操作还没有结束。' } satisfies WebActionResult
  }

  const requestId = createId('web-req')
  const userMessage: WebMessage = {
    id: createId('web-user'),
    role: 'user',
    content: prompt,
    createdAt: Date.now(),
  }
  updateWeb(nodeId, (data) => ({
    ...data,
    visibleMessages: upsertMessages(data.visibleMessages, [userMessage]),
    mirrorState: 'submitting',
    mirrorError: undefined,
    pendingRequestId: requestId,
  }))

  try {
    await sendWebBridgeCommand(
      {
        type: 'composer.submit',
        nodeId,
        requestId,
        text: prompt,
      },
      20_000,
    )
    const current = getWebNode(nodeId)
    if (current?.data.pendingRequestId === requestId && current.data.mirrorState === 'submitting') {
      updateWeb(nodeId, (data) => ({ ...data, mirrorState: 'answering' }))
    }
    return { ok: true } satisfies WebActionResult
  } catch (error) {
    const bridgeError = error instanceof WebBridgeError ? error : null
    const unknown = bridgeError?.code === 'BRIDGE_TIMEOUT' || bridgeError?.code === 'SUBMIT_UNKNOWN'
    const message = errorMessage(error)
    updateWeb(nodeId, (data) =>
      data.pendingRequestId === requestId
        ? {
            ...data,
            visibleMessages: unknown
              ? data.visibleMessages
              : data.visibleMessages.filter((entry) => entry.id !== userMessage.id),
            mirrorState: unknown ? 'unknown' : 'error',
            mirrorError: unknown
              ? '提交结果未知。先打开原网页核对，不要直接重复发送。'
              : message,
            pendingRequestId: unknown ? requestId : undefined,
          }
        : data,
    )
    return { ok: false, error: message, unknown } satisfies WebActionResult
  }
}

export async function refreshWebControls(nodeId: string) {
  const node = getWebNode(nodeId)
  if (!node || node.data.bindingState !== 'bound') return
  try {
    const data = await sendWebBridgeCommand<BridgeControls>(
      { type: 'controls.get', nodeId },
      8_000,
    )
    applyControls(nodeId, data)
  } catch (error) {
    updateWeb(nodeId, (data) => ({
      ...data,
      controlsError: errorMessage(error),
      controlsUpdatedAt: Date.now(),
    }))
  }
}

export async function setWebControl(
  nodeId: string,
  controlId: string,
  value: string | boolean,
) {
  try {
    const data = await sendWebBridgeCommand<BridgeControls>(
      { type: 'controls.set', nodeId, controlId, value },
      8_000,
    )
    applyControls(nodeId, data)
    return { ok: true } satisfies WebActionResult
  } catch (error) {
    const message = errorMessage(error)
    updateWeb(nodeId, (data) => ({ ...data, controlsError: message }))
    return { ok: false, error: message } satisfies WebActionResult
  }
}

export async function refreshWebNodeBindings() {
  const nodes = useCanvasStore.getState().nodes.filter((node) => node.data.kind === 'web')
  for (const node of nodes) {
    try {
      const info = await sendWebBridgeCommand<BridgeBinding | BridgeBindingInfo>(
        { type: 'conversation.getInfo', nodeId: node.id },
        2_500,
      )
      if ('tabId' in info) {
        applyBinding(node.id, info)
        void refreshWebControls(node.id)
        continue
      }
      if (info.bindingState === 'tab-closed') {
        updateWeb(node.id, (data) => ({
          ...data,
          runtimeTabId: undefined,
          bindingState: 'tab-closed',
          syncMode: 'linked-tab',
          mirrorState: data.visibleMessages.length ? 'stale' : 'unavailable',
          mirrorError: '网页标签页已关闭。打开网页后可重新连接。',
          pendingRequestId: undefined,
        }))
      } else if (info.bindingState === 'unbound') {
        updateWeb(node.id, (data) => {
          if (data.bindingState === 'extension-missing') {
            return {
              ...data,
              bindingState: 'unbound',
              syncMode: 'shortcut',
              mirrorState: data.visibleMessages.length ? 'stale' : 'unavailable',
              mirrorError: undefined,
              pendingRequestId: undefined,
            }
          }
          if (
            data.bindingState === 'bound' ||
            data.bindingState === 'error' ||
            data.bindingState === 'tab-closed'
          ) {
            return {
              ...data,
              runtimeTabId: undefined,
              bindingState: 'unbound',
              syncMode: 'shortcut',
              mirrorState: data.visibleMessages.length ? 'stale' : 'unavailable',
              mirrorError: '网页绑定已失效，请重新打开并绑定。',
              pendingRequestId: undefined,
            }
          }
          return data
        })
      }
    } catch {
      // A node may be unbound or the extension may have gone away again.
    }
  }
}

export function handleWebBridgeEvent(event: BridgeEvent) {
  if (event.type === 'bridge.ready') return
  if (event.type === 'bridge.disconnected') {
    const nodes = useCanvasStore.getState().nodes
    for (const node of nodes) {
      if (node.data.kind !== 'web' || node.data.bindingState !== 'bound') continue
      updateWeb(node.id, (data) => ({
        ...data,
        bindingState: 'error',
        syncMode: 'linked-tab',
        mirrorState: data.visibleMessages.length ? 'stale' : 'unavailable',
        mirrorError: '扩展连接已断开。正在尝试重连；也可重新打开网页核对。',
        pendingRequestId: undefined,
      }))
    }
    return
  }

  if (!event.nodeId) return
  const node = getWebNode(event.nodeId)
  if (!node) return

  if (event.type === 'binding.updated') {
    applyBinding(event.nodeId, event.binding)
    if (!node.data.controls?.length) void refreshWebControls(event.nodeId)
    return
  }

  if (event.type === 'mirror.update') {
    const terminal = ['ready', 'needs-login', 'stale', 'unknown', 'error'].includes(event.state)
    updateWeb(event.nodeId, (data) => ({
      ...data,
      visibleMessages: upsertMessages(data.visibleMessages, event.messages),
      conversationUrl: event.conversationUrl || data.conversationUrl,
      pageTitle: event.pageTitle || data.pageTitle,
      mirrorState: event.state,
      mirrorError: event.error,
      lastSyncedAt: event.state === 'ready' ? Date.now() : data.lastSyncedAt,
      pendingRequestId: terminal ? undefined : data.pendingRequestId,
      syncMode:
        event.state === 'stale' || event.state === 'needs-login' ? 'linked-tab' : data.syncMode,
      bindingState:
        event.state === 'needs-login' ? 'permission-required' : data.bindingState,
    }))
    return
  }

  if (event.type === 'tab.closed') {
    updateWeb(event.nodeId, (data) => ({
      ...data,
      runtimeTabId: undefined,
      bindingState: 'tab-closed',
      syncMode: 'linked-tab',
      mirrorState: data.visibleMessages.length ? 'stale' : 'unavailable',
      mirrorError: '网页标签页已关闭。打开网页后可重新绑定。',
      pendingRequestId: undefined,
    }))
    return
  }

  if (event.type === 'web.changed') {
    updateWeb(event.nodeId, (data) => ({
      ...data,
      bindingState: 'bound',
      syncMode: 'linked-tab',
      mirrorState: 'stale',
      mirrorError: '网页已变化，本地镜像不再标记为最新。请打开原网页核对。',
      pendingRequestId: undefined,
    }))
    return
  }

  if (event.type === 'error') {
    updateWeb(event.nodeId, (data) => ({
      ...data,
      mirrorError: event.message,
    }))
  }
}
