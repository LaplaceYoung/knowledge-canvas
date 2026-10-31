const ADAPTER_VERSION = 'chatgpt-dom-0.1'
const ACTIVE_RUNS = new Map()
const POLL_MS = 700
const STABLE_TICKS = 3
const RUN_TIMEOUT_MS = 5 * 60 * 1000

function getComposer() {
  return (
    document.querySelector('#prompt-textarea') ||
    document.querySelector('textarea[data-testid="prompt-textarea"]') ||
    document.querySelector('[contenteditable="true"][data-placeholder]')
  )
}

function getMessages() {
  const entries = []
  const nodes = document.querySelectorAll('[data-message-author-role]')
  nodes.forEach((node, index) => {
    const role = node.getAttribute('data-message-author-role')
    if (role !== 'user' && role !== 'assistant') return
    const content = (node.innerText || '').trim()
    if (!content) return
    entries.push({
      id: node.getAttribute('data-message-id') || `chatgpt-${index}-${role}`,
      role,
      content,
      createdAt: Date.now(),
    })
  })
  return entries.slice(-100)
}

function getSendButton() {
  return (
    document.querySelector('button[data-testid="send-button"]') ||
    document.querySelector('button[aria-label="Send prompt"]') ||
    document.querySelector('button[aria-label*="Send"]')
  )
}

function setComposerValue(composer, text) {
  composer.focus()
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(composer, text)
    composer.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    composer.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  if (composer instanceof HTMLElement && composer.isContentEditable) {
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(composer)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
    const inserted = document.execCommand('insertText', false, text)
    composer.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      }),
    )
    return inserted || (composer.innerText || '').includes(text)
  }

  return false
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForEnabledSendButton() {
  for (let index = 0; index < 20; index += 1) {
    const button = getSendButton()
    if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return button
    await sleep(150)
  }
  return null
}

function sendRunUpdate(run, state, messages, error) {
  try {
    chrome.runtime.sendMessage({
      type: 'KC_MIRROR_UPDATE',
      nodeId: run.nodeId,
      requestId: run.requestId,
      state,
      messages,
      url: location.href,
      title: document.title,
      error,
    })
  } catch {
    // The extension context can disappear when the page is closed or updated.
  }
}

function stopRun(run, state, messages, error) {
  clearInterval(run.timer)
  ACTIVE_RUNS.delete(run.requestId)
  sendRunUpdate(run, state, messages || [], error)
}

function startRun(nodeId, requestId, baselineCount) {
  const run = {
    nodeId,
    requestId,
    baselineCount,
    lastSignature: '',
    stableTicks: 0,
    startedAt: Date.now(),
    timer: null,
  }
  ACTIVE_RUNS.set(requestId, run)

  run.timer = setInterval(() => {
    if (Date.now() - run.startedAt > RUN_TIMEOUT_MS) {
      stopRun(run, 'unknown', getMessages().slice(run.baselineCount), '等待网页回答超时，请打开网页核对。')
      return
    }

    const messages = getMessages().slice(run.baselineCount)
    if (!messages.length) return
    const last = messages[messages.length - 1]
    const signature = messages
      .map((message) => `${message.id}:${message.role}:${message.content.length}:${message.content.slice(-80)}`)
      .join('|')
    const hasAssistant = messages.some(
      (message) => message.role === 'assistant' && message.content.trim(),
    )

    if (signature !== run.lastSignature) {
      run.lastSignature = signature
      run.stableTicks = 0
      sendRunUpdate(run, 'answering', messages)
      return
    }

    if (!hasAssistant) return
    run.stableTicks += 1
    if (run.stableTicks >= STABLE_TICKS) {
      stopRun(run, 'ready', messages)
    }
  }, POLL_MS)
}

async function submitPrompt(message) {
  const existingRun = ACTIVE_RUNS.get(message.requestId)
  if (existingRun) return { accepted: true, deduplicated: true }

  const composer = getComposer()
  if (!composer) {
    return {
      accepted: false,
      error: '网页输入框不可用，可能需要登录或完成验证码。',
    }
  }

  const baselineCount = getMessages().length
  if (!setComposerValue(composer, message.text)) {
    return { accepted: false, error: '无法写入网页输入框。' }
  }

  const button = await waitForEnabledSendButton()
  if (!button) {
    return { accepted: false, error: '网页发送按钮不可用，请在原网页完成登录或验证。' }
  }

  try {
    button.click()
  } catch {
    return { accepted: false, error: '无法点击网页发送按钮。', unknown: true }
  }

  startRun(message.nodeId, message.requestId, baselineCount)
  return { accepted: true }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'KC_GET_INFO') {
    const composer = getComposer()
    sendResponse({
      ok: true,
      adapterVersion: ADAPTER_VERSION,
      url: location.href,
      title: document.title,
      hasComposer: Boolean(composer),
      messageCount: getMessages().length,
    })
    return false
  }

  if (message?.type === 'KC_GET_TRANSCRIPT') {
    sendResponse({
      ok: true,
      adapterVersion: ADAPTER_VERSION,
      url: location.href,
      title: document.title,
      messages: getMessages(),
    })
    return false
  }

  if (message?.type === 'KC_SUBMIT_PROMPT') {
    submitPrompt(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          accepted: false,
          error: error instanceof Error ? error.message : '网页提交失败。',
        }),
      )
    return true
  }

  return false
})
