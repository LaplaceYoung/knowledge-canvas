const EXTENSION_VERSION = '0.3.0'
const BINDINGS_KEY = 'knowledge_canvas_web_bindings_v1'
const ALLOWED_CANVAS_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

const PROVIDERS = {
  chatgpt: {
    id: 'chatgpt',
    homeUrl: 'https://chatgpt.com/',
    origins: ['https://chatgpt.com', 'https://chat.openai.com'],
    mirrorSupported: true,
    adapterVersion: 'chatgpt-dom-0.3.0',
  },
  claude: {
    id: 'claude',
    homeUrl: 'https://claude.ai/new',
    origins: ['https://claude.ai'],
    mirrorSupported: true,
    adapterVersion: 'claude-dom-0.3.0',
  },
  gemini: {
    id: 'gemini',
    homeUrl: 'https://gemini.google.com/app',
    origins: ['https://gemini.google.com'],
    mirrorSupported: true,
    adapterVersion: 'gemini-dom-0.3.0',
  },
  grok: {
    id: 'grok',
    homeUrl: 'https://grok.com/',
    origins: ['https://grok.com'],
    mirrorSupported: true,
    adapterVersion: 'grok-dom-0.3.0',
  },
  deepseek: {
    id: 'deepseek',
    homeUrl: 'https://chat.deepseek.com/',
    origins: ['https://chat.deepseek.com'],
    mirrorSupported: true,
    adapterVersion: 'deepseek-dom-0.3.0',
  },
  doubao: {
    id: 'doubao',
    homeUrl: 'https://www.doubao.com/chat/',
    origins: ['https://www.doubao.com', 'https://doubao.com'],
    mirrorSupported: true,
    adapterVersion: 'doubao-dom-0.3.0',
  },
  qwen: {
    id: 'qwen',
    homeUrl: 'https://chat.qwen.ai/',
    origins: ['https://www.qwen.com', 'https://qwen.com', 'https://chat.qwen.ai'],
    mirrorSupported: true,
    adapterVersion: 'qwen-dom-0.3.0',
  },
  kimi: {
    id: 'kimi',
    homeUrl: 'https://www.kimi.com/',
    origins: ['https://www.kimi.com', 'https://kimi.com'],
    mirrorSupported: true,
    adapterVersion: 'kimi-dom-0.3.0',
  },
}

const ports = new Set()
let bindingsPromise = null

function providerOf(value) {
  return PROVIDERS[value] ?? null
}

function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_CANVAS_ORIGINS.has(origin)
}

function urlFrom(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isProviderUrl(provider, value) {
  const url = urlFrom(value)
  return Boolean(url && provider.origins.includes(url.origin))
}

function isProviderHome(provider, value) {
  const url = urlFrom(value)
  return Boolean(url && provider.origins.includes(url.origin) && (url.pathname === '/' || url.pathname === ''))
}

async function loadBindings() {
  if (!bindingsPromise) {
    bindingsPromise = chrome.storage.session
      .get(BINDINGS_KEY)
      .then((value) => {
        const stored = value?.[BINDINGS_KEY]
        return Array.isArray(stored) ? stored : []
      })
      .catch(() => [])
  }
  return bindingsPromise
}

async function saveBindings(bindings) {
  bindingsPromise = Promise.resolve(bindings)
  await chrome.storage.session.set({ [BINDINGS_KEY]: bindings }).catch(() => undefined)
}

function bindingForNode(bindings, nodeId) {
  return bindings.find((binding) => binding.nodeId === nodeId)
}

function bindingForTab(bindings, tabId) {
  return bindings.find((binding) => binding.tabId === tabId)
}

function bindingPayload(binding, title) {
  return {
    nodeId: binding.nodeId,
    providerId: binding.providerId,
    tabId: binding.tabId,
    title: title ?? binding.title ?? '',
    conversationUrl: binding.conversationUrl,
    mirror: binding.mirror,
    mirrorArmed: binding.mirrorArmed,
    adapterVersion: binding.adapterVersion,
    bindingState: 'bound',
    syncMode: binding.mirror ? 'dom-mirror' : 'linked-tab',
  }
}

function broadcast(event) {
  for (const port of [...ports]) {
    try {
      port.postMessage(event)
    } catch {
      ports.delete(port)
    }
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter(
      (message) =>
        message &&
        typeof message.id === 'string' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string',
    )
    .slice(-100)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content.slice(0, 40_000),
      createdAt: Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
    }))
}

async function getTab(tabId) {
  if (typeof tabId !== 'number') return null
  try {
    return await chrome.tabs.get(tabId)
  } catch {
    return null
  }
}

async function pinTab(tabId) {
  try {
    await chrome.windows.update((await chrome.tabs.get(tabId)).windowId, { focused: true })
    await chrome.tabs.update(tabId, { active: true })
  } catch {
    // The browser may reject focus requests; the tab can still be used.
  }
}

async function bindNodeToTab(nodeId, provider, tab) {
  const bindings = await loadBindings()
  if (!tab?.id || !isProviderUrl(provider, tab.url)) {
    throw Object.assign(new Error('目标标签页不属于当前 Provider。'), { code: 'INVALID_TAB' })
  }
  const sameTab = bindingForTab(bindings, tab.id)
  if (sameTab && sameTab.nodeId !== nodeId) {
    throw Object.assign(new Error('这个标签页已经绑定到另一个 Web 节点。'), {
      code: 'TAB_ALREADY_BOUND',
    })
  }
  const existing = bindingForNode(bindings, nodeId)
  if (existing && existing.tabId !== tab.id) {
    const oldTab = await getTab(existing.tabId)
    if (oldTab) {
      throw Object.assign(new Error('这个节点已经绑定了另一个标签页，请先解除绑定。'), {
        code: 'NODE_ALREADY_BOUND',
      })
    }
  }

  const canonical = tab.url || provider.homeUrl
  if (!isProviderHome(provider, canonical)) {
    const duplicate = bindings.find(
      (binding) =>
        binding.nodeId !== nodeId &&
        binding.providerId === provider.id &&
        binding.conversationUrl === canonical,
    )
    if (duplicate) {
      throw Object.assign(new Error('这个网页会话已经绑定到另一个 Web 节点。'), {
        code: 'URL_ALREADY_BOUND',
      })
    }
  }

  const mirrorArmed = Boolean(provider.mirrorSupported)
  const binding = {
    nodeId,
    providerId: provider.id,
    tabId: tab.id,
    title: tab.title || provider.id,
    conversationUrl: canonical,
    mirror: mirrorArmed,
    mirrorArmed,
    adapterVersion: mirrorArmed ? provider.adapterVersion : undefined,
    updatedAt: Date.now(),
  }
  const next = bindings.filter((entry) => entry.nodeId !== nodeId)
  next.push(binding)
  await saveBindings(next)
  return binding
}

async function openProviderTab(nodeId, provider, preferredUrl) {
  const url = preferredUrl && isProviderUrl(provider, preferredUrl) ? preferredUrl : provider.homeUrl
  let tab = await chrome.tabs.create({ url, active: true })
  if (!tab.id) throw new Error('无法打开 Provider 标签页。')

  const deadline = Date.now() + 8_000
  while (Date.now() < deadline && !isProviderUrl(provider, tab.url || '')) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    tab = await getTab(tab.id)
    if (!tab) break
  }
  if (!tab?.id || !isProviderUrl(provider, tab.url)) {
    throw Object.assign(new Error('Provider 标签页没有加载到允许的地址。'), {
      code: 'TAB_NOT_READY',
    })
  }

  const binding = await bindNodeToTab(nodeId, provider, tab)
  broadcast({ type: 'binding.updated', nodeId, binding: bindingPayload(binding, tab.title) })
  return bindingPayload(binding, tab.title)
}

async function getActiveProviderTab(provider) {
  const tabs = await chrome.tabs.query({})
  const matches = tabs.filter((tab) => tab.id && isProviderUrl(provider, tab.url || ''))
  matches.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
  return matches[0] || null
}

async function commandPing() {
  return {
    version: EXTENSION_VERSION,
    extensionId: chrome.runtime.id,
    providers: Object.keys(PROVIDERS),
  }
}

async function commandCreate(message) {
  const provider = providerOf(message.providerId)
  if (!provider) throw Object.assign(new Error('Provider 不在 allowlist 中。'), { code: 'INVALID_PROVIDER' })
  if (typeof message.nodeId !== 'string' || !message.nodeId) {
    throw Object.assign(new Error('缺少 Web 节点 ID。'), { code: 'INVALID_NODE' })
  }
  return openProviderTab(message.nodeId, provider)
}

async function commandBind(message) {
  const provider = providerOf(message.providerId)
  if (!provider) throw Object.assign(new Error('Provider 不在 allowlist 中。'), { code: 'INVALID_PROVIDER' })
  if (typeof message.nodeId !== 'string' || !message.nodeId) {
    throw Object.assign(new Error('缺少 Web 节点 ID。'), { code: 'INVALID_NODE' })
  }
  let tab = message.tabId ? await getTab(message.tabId) : null
  if (!tab) tab = await getActiveProviderTab(provider)
  if (!tab) {
    throw Object.assign(new Error(`没有找到 ${provider.id} 标签页，请先打开网页。`), {
      code: 'TAB_NOT_FOUND',
    })
  }
  const binding = await bindNodeToTab(message.nodeId, provider, tab)
  broadcast({ type: 'binding.updated', nodeId: message.nodeId, binding: bindingPayload(binding, tab.title) })
  return bindingPayload(binding, tab.title)
}

async function commandFocus(message) {
  const bindings = await loadBindings()
  const binding = bindingForNode(bindings, message.nodeId)
  if (binding) {
    const tab = await getTab(binding.tabId)
    if (tab) {
      await pinTab(binding.tabId)
      return bindingPayload(binding, tab.title)
    }
    const provider = providerOf(binding.providerId)
    if (!provider) throw new Error('Provider 不在 allowlist 中。')
    const next = bindings.filter((entry) => entry.nodeId !== message.nodeId)
    await saveBindings(next)
    return openProviderTab(
      message.nodeId,
      provider,
      isProviderUrl(provider, binding.conversationUrl) ? binding.conversationUrl : provider.homeUrl,
    )
  }
  const provider = providerOf(message.providerId)
  if (!provider) throw Object.assign(new Error('Provider 不在 allowlist 中。'), { code: 'INVALID_PROVIDER' })
  return openProviderTab(message.nodeId, provider, message.conversationUrl)
}

async function commandUnbind(message) {
  const bindings = await loadBindings()
  const next = bindings.filter((binding) => binding.nodeId !== message.nodeId)
  await saveBindings(next)
  return { nodeId: message.nodeId, unbound: true }
}

async function commandGetInfo(message) {
  const bindings = await loadBindings()
  const binding = bindingForNode(bindings, message.nodeId)
  if (!binding) return { bindingState: 'unbound' }
  const tab = await getTab(binding.tabId)
  if (!tab) {
    await saveBindings(bindings.filter((entry) => entry.nodeId !== message.nodeId))
    return { bindingState: 'tab-closed', conversationUrl: binding.conversationUrl }
  }
  return bindingPayload(binding, tab.title)
}

async function sendToContentScript(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError?.message
      if (error) {
        reject(Object.assign(new Error(error), { code: 'CONTENT_SCRIPT_UNAVAILABLE' }))
        return
      }
      resolve(response)
    })
  })
}

async function commandGetTranscript(message) {
  const bindings = await loadBindings()
  const binding = bindingForNode(bindings, message.nodeId)
  if (!binding) throw Object.assign(new Error('Web 节点还没有绑定标签页。'), { code: 'NOT_BOUND' })
  if (!binding.mirrorArmed || binding.stale) {
    throw Object.assign(new Error('当前会话不能读取镜像消息。'), {
      code: 'MIRROR_UNAVAILABLE',
    })
  }
  const response = await sendToContentScript(binding.tabId, { type: 'KC_GET_TRANSCRIPT' })
  if (!response?.ok) {
    throw Object.assign(new Error(response?.error || '网页适配器没有返回消息。'), {
      code: 'ADAPTER_ERROR',
    })
  }
  binding.updatedAt = Date.now()
  await saveBindings(bindings)
  return {
    title: response.title || binding.title,
    conversationUrl: response.url || binding.conversationUrl,
    messages: normalizeMessages(response.messages),
    mirror: true,
  }
}

async function commandGetControls(message) {
  const bindings = await loadBindings()
  const binding = bindingForNode(bindings, message.nodeId)
  if (!binding) throw Object.assign(new Error('Web 节点还没有绑定标签页。'), { code: 'NOT_BOUND' })
  const tab = await getTab(binding.tabId)
  if (!tab) {
    broadcast({ type: 'tab.closed', nodeId: message.nodeId })
    throw Object.assign(new Error('网页标签页已关闭，请重新打开并绑定。'), { code: 'TAB_CLOSED' })
  }
  let response
  try {
    response = await sendToContentScript(binding.tabId, { type: 'KC_GET_CONTROLS' })
  } catch {
    throw Object.assign(new Error('网页适配器未就绪，刷新网页后重试。'), {
      code: 'ADAPTER_UNAVAILABLE',
    })
  }
  if (!response?.ok) {
    throw Object.assign(new Error(response?.error || '网页没有返回控制项。'), {
      code: 'ADAPTER_ERROR',
    })
  }
  return {
    provider: binding.providerId,
    title: response.title || binding.title,
    conversationUrl: response.url || binding.conversationUrl,
    controls: Array.isArray(response.controls) ? response.controls : [],
  }
}

async function commandSetControl(message) {
  const controlId = typeof message.controlId === 'string' ? message.controlId : ''
  if (!controlId) throw Object.assign(new Error('缺少控制项。'), { code: 'INVALID_CONTROL' })
  const bindings = await loadBindings()
  const binding = bindingForNode(bindings, message.nodeId)
  if (!binding) throw Object.assign(new Error('Web 节点还没有绑定标签页。'), { code: 'NOT_BOUND' })
  const tab = await getTab(binding.tabId)
  if (!tab) {
    broadcast({ type: 'tab.closed', nodeId: message.nodeId })
    throw Object.assign(new Error('网页标签页已关闭，请重新打开并绑定。'), { code: 'TAB_CLOSED' })
  }
  let response
  try {
    response = await sendToContentScript(binding.tabId, {
      type: 'KC_SET_CONTROL',
      controlId,
      value: message.value,
    })
  } catch {
    throw Object.assign(new Error('网页适配器未就绪，刷新网页后重试。'), {
      code: 'ADAPTER_UNAVAILABLE',
    })
  }
  if (!response?.ok) {
    throw Object.assign(new Error(response?.error || '网页没有接受控制项修改。'), {
      code: 'ADAPTER_ERROR',
    })
  }
  return {
    provider: binding.providerId,
    title: response.title || binding.title,
    conversationUrl: response.url || binding.conversationUrl,
    controls: Array.isArray(response.controls) ? response.controls : [],
  }
}

async function commandSubmit(message) {
  const text = typeof message.text === 'string' ? message.text.trim() : ''
  if (!text || text.length > 8_000) {
    throw Object.assign(new Error('提交内容为空或超过 8000 字符。'), { code: 'INVALID_PROMPT' })
  }
  const bindings = await loadBindings()
  const binding = bindingForNode(bindings, message.nodeId)
  if (!binding) throw Object.assign(new Error('Web 节点还没有绑定标签页。'), { code: 'NOT_BOUND' })
  if (!binding.mirrorArmed || binding.stale) {
    throw Object.assign(new Error('当前会话不能从节点提交。'), {
      code: 'MIRROR_UNAVAILABLE',
    })
  }
  const tab = await getTab(binding.tabId)
  if (!tab) {
    broadcast({ type: 'tab.closed', nodeId: message.nodeId })
    throw Object.assign(new Error('网页标签页已关闭，请重新打开并绑定。'), { code: 'TAB_CLOSED' })
  }
  const response = await sendToContentScript(binding.tabId, {
    type: 'KC_SUBMIT_PROMPT',
    nodeId: message.nodeId,
    requestId: message.requestId,
    text,
  })
  if (!response?.accepted) {
    const unknown = Boolean(response?.unknown)
    broadcast({
      type: 'mirror.update',
      nodeId: message.nodeId,
      requestId: message.requestId,
      state: unknown ? 'unknown' : 'error',
      messages: [],
      error: response?.error || '网页适配器没有接受提交。',
    })
    throw Object.assign(new Error(response?.error || '网页适配器没有接受提交。'), {
      code: unknown ? 'SUBMIT_UNKNOWN' : 'SUBMIT_REJECTED',
    })
  }
  return { accepted: true, requestId: message.requestId }
}

async function handleContentEvent(message, sender) {
  if (message?.type === 'KC_MIRROR_UPDATE') {
    const bindings = await loadBindings()
    const binding = bindingForNode(bindings, message.nodeId)
    if (!binding || sender.tab?.id !== binding.tabId) {
      return { ok: false, error: 'unknown binding' }
    }
    const bindingProvider = providerOf(binding.providerId)
    if (
      bindingProvider &&
      typeof message.url === 'string' &&
      isProviderUrl(bindingProvider, message.url)
    ) {
      binding.conversationUrl = message.url
    }
    if (typeof message.title === 'string' && message.title) binding.title = message.title
    binding.updatedAt = Date.now()
    await saveBindings(bindings)
    broadcast({
      type: 'mirror.update',
      nodeId: message.nodeId,
      requestId: String(message.requestId || ''),
      state: ['answering', 'ready', 'needs-login', 'stale', 'unknown', 'error'].includes(message.state)
        ? message.state
        : 'unknown',
      messages: normalizeMessages(message.messages),
      conversationUrl: typeof message.url === 'string' ? message.url : undefined,
      pageTitle: typeof message.title === 'string' ? message.title : undefined,
      error: typeof message.error === 'string' ? message.error : undefined,
    })
    return { ok: true }
  }
  if (message?.type === 'KC_PAGE_CHANGED') {
    const bindings = await loadBindings()
    const binding = bindingForTab(bindings, sender.tab?.id)
    if (binding) {
      broadcast({
        type: 'web.changed',
        nodeId: binding.nodeId,
        conversationUrl: typeof message.url === 'string' ? message.url : binding.conversationUrl,
      })
    }
    return { ok: true }
  }
  return { ok: false, error: 'unknown content message' }
}

async function handleCommand(message) {
  if (!message || typeof message.type !== 'string') {
    throw Object.assign(new Error('缺少命令类型。'), { code: 'INVALID_COMMAND' })
  }
  switch (message.type) {
    case 'ping':
      return commandPing()
    case 'web.create':
      return commandCreate(message)
    case 'conversation.bind':
      return commandBind(message)
    case 'conversation.focus':
      return commandFocus(message)
    case 'conversation.unbind':
      return commandUnbind(message)
    case 'conversation.getInfo':
      return commandGetInfo(message)
    case 'transcript.getVisible':
      return commandGetTranscript(message)
    case 'controls.get':
      return commandGetControls(message)
    case 'controls.set':
      return commandSetControl(message)
    case 'composer.submit':
      return commandSubmit(message)
    default:
      throw Object.assign(new Error('不允许的命令。'), { code: 'UNKNOWN_COMMAND' })
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedOrigin(sender.origin)) {
    sendResponse({
      ok: false,
      error: { code: 'ORIGIN_REJECTED', message: '画布来源不在 allowlist 中。' },
    })
    return false
  }
  handleCommand(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: {
          code: error?.code || 'BRIDGE_ERROR',
          message: error instanceof Error ? error.message : '扩展命令失败。',
        },
      })
    })
  return true
})

chrome.runtime.onConnectExternal.addListener((port) => {
  if (!isAllowedOrigin(port.sender?.origin)) {
    port.disconnect()
    return
  }
  ports.add(port)
  port.postMessage({ type: 'bridge.ready', version: EXTENSION_VERSION })
  port.onDisconnect.addListener(() => ports.delete(port))
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('KC_')) return false
  handleContentEvent(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error) }))
  return true
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) return
  const bindings = await loadBindings()
  const binding = bindingForTab(bindings, tabId)
  if (!binding) return
  const provider = providerOf(binding.providerId)
  if (!provider) return
  if (changeInfo.url) {
    if (!isProviderUrl(provider, changeInfo.url)) {
      broadcast({ type: 'web.changed', nodeId: binding.nodeId, conversationUrl: changeInfo.url })
      return
    }

    binding.conversationUrl = changeInfo.url
    binding.updatedAt = Date.now()
    await saveBindings(bindings)
    broadcast({
      type: 'binding.updated',
      nodeId: binding.nodeId,
      binding: bindingPayload(binding, changeInfo.title || tab.title),
    })
  }
  if (changeInfo.title) {
    binding.title = changeInfo.title
    binding.updatedAt = Date.now()
    await saveBindings(bindings)
    broadcast({
      type: 'binding.updated',
      nodeId: binding.nodeId,
      binding: bindingPayload(binding, changeInfo.title),
    })
  }
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const bindings = await loadBindings()
  const binding = bindingForTab(bindings, tabId)
  if (!binding) return
  await saveBindings(bindings.filter((entry) => entry.tabId !== tabId))
  broadcast({ type: 'tab.closed', nodeId: binding.nodeId })
})
