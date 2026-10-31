const ADAPTER_VERSION = 'web-dom-0.3.1'
const ACTIVE_RUNS = new Map()
const OPTION_CACHE = new Map()
const POLL_MS = 350
const STABLE_TICKS = 3
const RUN_TIMEOUT_MS = 5 * 60 * 1000

function detectProvider() {
  const host = location.hostname
  if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'chatgpt'
  if (host === 'claude.ai') return 'claude'
  if (host === 'gemini.google.com') return 'gemini'
  if (host === 'grok.com') return 'grok'
  if (host === 'chat.deepseek.com') return 'deepseek'
  if (host === 'www.doubao.com' || host === 'doubao.com') return 'doubao'
  if (host === 'www.qwen.com' || host === 'qwen.com' || host === 'chat.qwen.ai' || host === 'www.qianwen.com' || host === 'qianwen.com') return 'qwen'
  if (host === 'www.kimi.com' || host === 'kimi.com') return 'kimi'
  return null
}

const PROVIDER_ID = detectProvider()

function visible(element) {
  if (!(element instanceof Element)) return false
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  )
}

function textOf(element) {
  return (element?.innerText || element?.textContent || '').trim().replace(/\s+/g, ' ')
}

function findFirst(selectors, root = document) {
  for (const selector of selectors) {
    const matches = root.querySelectorAll(selector)
    for (const element of matches) {
      if (visible(element)) return element
    }
  }
  return null
}

function findButton(regex, root = document) {
  const candidates = root.querySelectorAll('button, [role="button"], [aria-pressed]')
  for (const element of candidates) {
    if (!visible(element)) continue
    const label = [textOf(element), element.getAttribute('aria-label'), element.getAttribute('title')]
      .filter(Boolean)
      .join(' ')
    if (regex.test(label)) return element
  }
  return null
}

function isDisabled(element) {
  return Boolean(
    element.disabled ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.classList.contains('disabled') ||
      element.classList.contains('ds-button--disabled'),
  )
}

function getComposer() {
  const spec = PROVIDER_SPECS[PROVIDER_ID]
  const configured = spec ? findFirst(spec.composer) : null
  if (configured) return configured

  const editables = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
    .filter(visible)
    .filter(
      (element) =>
        !element.closest(
          '[data-message-author-role], article, .ds-message, .font-claude-message, user-query, model-response, [data-role="user"], [data-role="assistant"]',
        ),
    )
  editables.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)
  return editables[0] || null
}

function getSendButton() {
  const spec = PROVIDER_SPECS[PROVIDER_ID]
  const configured = spec ? findFirst(spec.send) : null
  if (configured && !isDisabled(configured)) return configured

  const candidates = [...document.querySelectorAll('button, [role="button"]')].filter(
    (element) =>
      visible(element) &&
      !isDisabled(element) &&
      !element.closest('aside, nav, [aria-label*="搜索对话"], [aria-label*="Search chats"]'),
  )
  const named = candidates.filter((element) => {
    const label = [textOf(element), element.getAttribute('aria-label'), element.getAttribute('title')]
      .filter(Boolean)
      .join(' ')
    return /发送|提交|send|submit/i.test(label)
  })
  return named[named.length - 1] || null
}

const SKIP_MARKDOWN_SELECTOR =
  'button, [role="button"], svg, style, script, noscript, textarea, input, select, canvas, video, audio, iframe, .sr-only, .cdk-visually-hidden, [aria-hidden="true"], [data-markdown-copy="exclude"], [data-testid*="copy"], [data-testid*="feedback"], [data-testid*="action"]'

function inlineMarkdownText(value) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function safeMarkdownUrl(value) {
  try {
    const url = new URL(value, location.href)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function escapeTableCell(value) {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

function serializeTable(table) {
  const rows = [...table.querySelectorAll('tr')]
    .map((row) => [...row.querySelectorAll(':scope > th, :scope > td')])
    .filter((cells) => cells.length > 0)
  if (!rows.length) return ''
  const matrix = rows.map((cells) =>
    cells.map((cell) => escapeTableCell(inlineMarkdownText(serializeChildren(cell)))),
  )
  const width = Math.max(...matrix.map((row) => row.length))
  const pad = (row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]
  const header = pad(matrix[0])
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...matrix.slice(1).map((row) => `| ${pad(row).join(' | ')} |`),
  ]
  return `\n\n${lines.join('\n')}\n\n`
}

function serializeList(list) {
  const ordered = list.tagName === 'OL'
  const items = [...list.children].filter((child) => child.tagName === 'LI')
  return (
    items
      .map((item, index) => {
        const nested = []
        let content = ''
        for (const child of item.childNodes) {
          if (child instanceof Element && (child.tagName === 'UL' || child.tagName === 'OL')) {
            nested.push(child)
            continue
          }
          content += serializeMarkdownNode(child)
        }
        const text = inlineMarkdownText(content)
        const nestedText = nested
          .map((child) => serializeList(child))
          .join('')
          .split('\n')
          .filter(Boolean)
          .map((line) => `  ${line}`)
          .join('\n')
        return `${ordered ? `${index + 1}. ` : '- '}${text}${nestedText ? `\n${nestedText}` : ''}`
      })
      .join('\n') + '\n\n'
  )
}

function codeFence(raw, language) {
  const text = raw.replace(/\n$/, '')
  if (!text.trim()) return ''
  return `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n`
}

function serializeCodeBlock(node) {
  const editor = node.querySelector(
    '.cm-content[data-language], [data-editor-search-surface] .cm-content, pre code, pre',
  )
  const language =
    editor?.getAttribute('data-language') ||
    node.querySelector('[data-language]')?.getAttribute('data-language') ||
    (node.innerText || '').slice(0, 100).match(/\b(python|javascript|typescript|bash|shell|json|html|css|sql|java|cpp|c\+\+|go|rust|ruby|php|swift|kotlin|yaml|markdown)\b/i)?.[1] ||
    ''

  if (!editor) return codeFence(node.innerText || node.textContent || '', language)
  const lines = [...editor.querySelectorAll('.cm-line')]
  const raw = lines.length
    ? lines.map((line) => line.textContent.replace(/\u00a0/g, ' ')).join('\n')
    : editor.innerText || editor.textContent || ''
  return codeFence(raw, language)
}

function serializeMarkdownNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return inlineMarkdownText(node.nodeValue)
  if (!(node instanceof Element)) return ''
  if (node.matches('.katex')) {
    const annotation = node.querySelector('annotation[encoding="application/x-tex"]')
    const tex = annotation?.textContent?.trim()
    if (tex) return node.closest('.katex-display') ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`
  }
  if (node.matches('[data-code-block="true"]')) return serializeCodeBlock(node)
  if (node.matches(SKIP_MARKDOWN_SELECTOR)) return ''
  const tag = node.tagName.toLowerCase()

  if (/^h[1-6]$/.test(tag)) {
    return `${'#'.repeat(Number(tag[1]))} ${inlineMarkdownText(serializeChildren(node))}\n\n`
  }

  switch (tag) {
    case 'br':
      return '\n'
    case 'hr':
      return '\n\n---\n\n'
    case 'p':
      return `${serializeChildren(node)}\n\n`
    case 'strong':
    case 'b': {
      const text = inlineMarkdownText(serializeChildren(node))
      return text ? `**${text}**` : ''
    }
    case 'em':
    case 'i': {
      const text = inlineMarkdownText(serializeChildren(node))
      return text ? `*${text}*` : ''
    }
    case 'del':
    case 's': {
      const text = inlineMarkdownText(serializeChildren(node))
      return text ? `~~${text}~~` : ''
    }
    case 'code': {
      if (node.closest('pre')) return node.textContent || ''
      const text = (node.textContent || '').trim()
      if (!text) return ''
      const ticks = text.includes('`') ? '``' : '`'
      return `${ticks}${text}${ticks}`
    }
    case 'pre': {
      const code = node.querySelector('code')
      const raw = (code?.textContent ?? node.textContent ?? '').replace(/\n$/, '')
      if (!raw.trim()) return ''
      const language = (
        (code?.className || '').match(/language-([\w-]+)/)?.[1] ||
        node.getAttribute('data-language') ||
        ''
      ).trim()
      return `\n\n\`\`\`${language}\n${raw}\n\`\`\`\n\n`
    }
    case 'blockquote': {
      const text = serializeChildren(node).trim()
      return text
        ? `\n\n${text
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')}\n\n`
        : ''
    }
    case 'ul':
    case 'ol':
      return serializeList(node)
    case 'table':
      return serializeTable(node)
    case 'a': {
      const text = inlineMarkdownText(serializeChildren(node))
      const href = safeMarkdownUrl(node.getAttribute('href') || '')
      return href && text ? `[${text}](${href})` : text
    }
    case 'img': {
      const alt = node.getAttribute('alt') || ''
      const src = safeMarkdownUrl(node.getAttribute('src') || '')
      return src ? `![${alt}](${src})` : alt ? `[图片：${alt}]` : ''
    }
    case 'li':
      return `${serializeChildren(node)}\n`
    default:
      return serializeChildren(node)
  }
}

function serializeChildren(node) {
  return [...node.childNodes].map(serializeMarkdownNode).join('')
}

function elementToMarkdown(root) {
  if (!root) return ''
  return serializeChildren(root)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getMessages() {
  const spec = PROVIDER_SPECS[PROVIDER_ID]
  if (!spec?.messages?.length) return []

  const entries = []
  for (const config of spec.messages) {
    const nodes = [...document.querySelectorAll(config.selector)]
    let index = 0
    for (const element of nodes) {
      if (!visible(element)) continue
      const contentElement = config.contentSelector
        ? findFirst(config.contentSelector.split(','), element)
        : element
      const content = elementToMarkdown(contentElement) || textOf(contentElement)
      if (!content) continue
      const role = config.role || element.getAttribute(config.roleAttr || 'data-role')
      if (role !== 'user' && role !== 'assistant') continue
      const explicitId = config.idAttr ? element.getAttribute(config.idAttr) : null
      entries.push({
        element,
        explicitId,
        message: {
          id: explicitId || `${PROVIDER_ID}-${role}-${index}`,
          role,
          content,
          format: 'markdown',
          createdAt: Date.now(),
        },
      })
      index += 1
    }
  }

  entries.sort((a, b) => {
    const position = a.element.compareDocumentPosition(b.element)
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  })

  const accepted = []
  for (const entry of entries) {
    const { role, content } = entry.message
    const nested = accepted.some(
      (previous) =>
        previous.message.role === role &&
        previous.message.content === content &&
        (previous.element.contains(entry.element) || entry.element.contains(previous.element)),
    )
    if (!nested) accepted.push(entry)
  }

  const messages = []
  const roleCounts = new Map()
  for (const entry of accepted) {
    const { role } = entry.message
    const count = roleCounts.get(role) || 0
    roleCounts.set(role, count + 1)
    messages.push({
      ...entry.message,
      id: entry.explicitId || `${PROVIDER_ID}-${role}-${count}`,
    })
  }
  return messages.slice(-100)
}

function setComposerValue(composer, value) {
  composer.focus()
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(composer, value)
    composer.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    composer.dispatchEvent(new Event('change', { bubbles: true }))
    return composer.value.includes(value)
  }

  if (composer instanceof HTMLElement && composer.isContentEditable) {
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(composer)
    selection?.removeAllRanges()
    selection?.addRange(range)
    const inserted = document.execCommand('insertText', false, value)
    composer.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value,
      }),
    )
    return inserted || (composer.innerText || '').includes(value)
  }

  return false
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForEnabledSendButton() {
  for (let index = 0; index < 20; index += 1) {
    const button = getSendButton()
    if (button) return button
    await sleep(150)
  }
  return null
}

function fallbackAssistantText(prompt) {
  const root = document.querySelector('main') || document.body
  const current = (root.innerText || '').trim()
  if (!current) return ''
  const index = current.lastIndexOf(prompt)
  if (index < 0) return ''
  return current
    .slice(index + prompt.length)
    .replace(/^(?:最新一条回复|回答已完成|正在回应|ChatGPT 正在回应|ChatGPT 可能会出错。请核查重要信息。)\s*/g, '')
    .replace(/\n(?:最新一条回复|回答已完成|思考|复制|朗读|编辑)\s*$/g, '')
    .trim()
    .slice(0, 20_000)
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
    // The extension context can disappear when the page closes or reloads.
  }
}

function stopRun(run, state, messages, error) {
  clearInterval(run.timer)
  ACTIVE_RUNS.delete(run.requestId)
  sendRunUpdate(run, state, messages || [], error)
}

function startRun(nodeId, requestId, baselineCount, prompt) {
  const run = {
    nodeId,
    requestId,
    baselineCount,
    prompt,
    lastSignature: '',
    stableTicks: 0,
    startedAt: Date.now(),
    timer: null,
  }
  ACTIVE_RUNS.set(requestId, run)

  run.timer = setInterval(() => {
    if (Date.now() - run.startedAt > RUN_TIMEOUT_MS) {
      stopRun(run, 'unknown', [], '等待网页回答超时，请打开网页核对。')
      return
    }

    let messages = getMessages().slice(run.baselineCount)
    const allowFallback = PROVIDER_SPECS[PROVIDER_ID]?.allowFallback !== false
    if (
      allowFallback &&
      !messages.some((message) => message.role === 'assistant' && message.content.trim())
    ) {
      const fallback = fallbackAssistantText(run.prompt)
      if (fallback.length > 2) {
        messages = [
          ...messages.filter((message) => message.role === 'user'),
          {
            id: `${PROVIDER_ID}-fallback-${run.requestId}`,
            role: 'assistant',
            content: fallback,
            format: 'text',
            createdAt: Date.now(),
          },
        ]
      }
    }
    if (!messages.length) return

    const hasAssistant = messages.some(
      (message) => message.role === 'assistant' && message.content.trim(),
    )
    const signature = messages
      .map((message) => `${message.id}:${message.role}:${message.content.length}:${message.content.slice(-80)}`)
      .join('|')

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
  try {
    if (button) {
      button.click()
    } else {
      composer.focus()
      composer.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      )
      composer.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      )
    }
  } catch {
    return { accepted: false, error: '无法提交网页输入框。', unknown: true }
  }

  startRun(message.nodeId, message.requestId, baselineCount, message.text)
  return { accepted: true }
}

function readToggleValue(element) {
  const pressed = element.getAttribute('aria-pressed')
  if (pressed === 'true' || pressed === 'false') return pressed === 'true'
  const checked = element.getAttribute('aria-checked')
  if (checked === 'true' || checked === 'false') return checked === 'true'
  const state = element.getAttribute('data-state')
  if (state === 'on' || state === 'off') return state === 'on'
  return /(^|[\s-])(selected|active|checked|is-active)([\s-]|$)|--selected/.test(
    String(element.className),
  )
}

function optionElements(trigger, config) {
  if (trigger instanceof HTMLSelectElement) {
    return [...trigger.options].map((option) => ({ element: option, label: option.textContent.trim() }))
  }
  const roots = [
    ...document.querySelectorAll(
      '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-headlessui-portal], [class*="popover"], [class*="dropdown"]',
    ),
  ].filter(visible)
  const selectors = config.optionSelector
    ? [config.optionSelector]
    : [
        '[role="menuitemradio"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="menuitemcheckbox"]',
      ]
  const found = []
  for (const root of roots.length ? roots : [document]) {
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (!visible(element) || element === trigger || trigger.contains(element)) continue
        if (element.closest('aside, nav, [role="navigation"]')) continue
        const label = textOf(element)
        if (!label || label.length > 120) continue
        if (/^(更多模型|更多|思考等级|思考强度|对话长度|设置|管理|自定义|帮助|了解更多|已包含在|Learn more|See more)/i.test(label)) {
          continue
        }
        if (/了解更多|已包含在|升级\s*$/i.test(label)) continue
        found.push({ element, label })
      }
    }
  }
  const seen = new Set()
  return found.filter((entry) => {
    if (seen.has(entry.label)) return false
    seen.add(entry.label)
    return true
  })
}

async function readSelectOptions(trigger, config) {
  if (trigger instanceof HTMLSelectElement) {
    return optionElements(trigger, config).map((entry) => ({
      value: entry.label,
      label: entry.label,
    }))
  }
  const cacheKey = `${PROVIDER_ID}:${config.id}`
  if (OPTION_CACHE.has(cacheKey)) return OPTION_CACHE.get(cacheKey)

  try {
    trigger.click()
    await sleep(260)
    const options = optionElements(trigger, config)
      .map((entry) => ({ value: entry.label, label: entry.label }))
      .slice(0, 60)
    const current = textOf(trigger)
    if (current && !options.some((option) => option.value === current)) {
      options.unshift({ value: current, label: current })
    }
    OPTION_CACHE.set(cacheKey, options)
    return options
  } finally {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      }),
    )
    await sleep(80)
  }
}

async function setSelectValue(trigger, config, value) {
  if (trigger instanceof HTMLSelectElement) {
    const option = [...trigger.options].find((entry) => entry.textContent.trim() === value)
    if (!option) return false
    option.selected = true
    trigger.dispatchEvent(new Event('input', { bubbles: true }))
    trigger.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  if (textOf(trigger) === value) return true
  trigger.click()
  await sleep(260)
  try {
    const target = optionElements(trigger, config).find(
      (entry) => entry.label === value || entry.label.startsWith(value) || value.startsWith(entry.label),
    )
    if (!target) return false
    target.element.click()
    await sleep(320)
    OPTION_CACHE.delete(`${PROVIDER_ID}:${config.id}`)
    return true
  } finally {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      }),
    )
  }
}

async function getControls() {
  const spec = PROVIDER_SPECS[PROVIDER_ID]
  let defs = []
  try {
    defs = spec?.controls ? await spec.controls() : []
  } catch {
    defs = []
  }
  if (!defs.length) defs = genericControlDefs()

  const controls = []
  for (const def of defs) {
    if (!def.element) continue
    if (def.type === 'toggle') {
      controls.push({
        id: def.id,
        label: def.label,
        type: 'toggle',
        value: readToggleValue(def.element),
      })
      continue
    }
    const options = def.options || (await readSelectOptions(def.element, def))
    controls.push({
      id: def.id,
      label: def.label,
      type: 'select',
      value: textOf(def.element) || def.value || '',
      options,
    })
  }
  return {
    provider: PROVIDER_ID,
    url: location.href,
    title: document.title,
    controls,
  }
}

async function setControl(controlId, value) {
  const spec = PROVIDER_SPECS[PROVIDER_ID]
  let defs = []
  try {
    defs = spec?.controls ? await spec.controls() : []
  } catch {
    defs = []
  }
  if (!defs.length) defs = genericControlDefs()
  const def = defs.find((entry) => entry.id === controlId)
  if (!def?.element) return { ok: false, error: '网页上找不到这个控制项。' }

  if (def.type === 'toggle') {
    const desired = value === true || value === 'true'
    const current = readToggleValue(def.element)
    if (current !== desired) {
      def.element.click()
      await sleep(280)
    }
  } else {
    const selected = await setSelectValue(def.element, def, String(value))
    if (!selected) return { ok: false, error: `网页没有找到“${value}”这个选项。` }
  }

  return { ok: true, ...(await getControls()) }
}

function findModelTrigger(selectors) {
  return findFirst(selectors)
}

function deepSeekToggle(regex) {
  return findButton(regex, document.querySelector('.ds-toggle-button')?.parentElement?.parentElement || document)
}

function chatGptControls() {
  return [
    {
      id: 'thinking',
      label: '思考',
      type: 'toggle',
      element: findButton(/^思考$|^Thinking$|Reason/i),
    },
    {
      id: 'model',
      label: '模型',
      type: 'select',
      element: findModelTrigger([
        'button[data-testid="model-switcher-dropdown-button"]',
        'button[aria-label*="模型"]',
        'button[aria-label*="Model"]',
      ]),
    },
  ]
}

function claudeControls() {
  return [
    {
      id: 'model',
      label: '模型 / 思考',
      type: 'select',
      element: findModelTrigger([
        'button[data-testid="model-selector-dropdown"]',
        'button[aria-label*="模型"]',
        'button[aria-label*="Model"]',
      ]),
    },
  ]
}

function geminiControls() {
  return [
    {
      id: 'model',
      label: '模型 / 思考',
      type: 'select',
      element: findModelTrigger(['button.input-area-switch', 'button[aria-label*="模式选择器"]', 'button[aria-label*="model"]']),
    },
  ]
}

function grokControls() {
  return [
    {
      id: 'model',
      label: '模型',
      type: 'select',
      element: findModelTrigger(['button[aria-label^="型号:"]', 'button[aria-label*="Model"]']),
    },
  ]
}

function deepSeekControls() {
  return [
    {
      id: 'thinking',
      label: '深度思考',
      type: 'toggle',
      element: deepSeekToggle(/深度思考|思考/),
    },
    {
      id: 'webSearch',
      label: '智能搜索',
      type: 'toggle',
      element: deepSeekToggle(/智能搜索|联网|搜索/),
    },
  ]
}

function doubaoControls() {
  return [
    {
      id: 'model',
      label: '模型 / 思考',
      type: 'select',
      element: findModelTrigger(['[data-testid="chat_input_action_model"]']),
    },
  ]
}

function kimiControls() {
  return [
    {
      id: 'model',
      label: '模型 / 思考',
      type: 'select',
      element: findModelTrigger(['[data-testid="model-select-trigger"]']),
    },
  ]
}

function genericControlDefs() {
  const composer = getComposer()
  const root =
    composer?.closest('form') ||
    composer?.closest('[class*="composer"]') ||
    composer?.closest('[class*="editor"]') ||
    composer?.parentElement?.parentElement?.parentElement ||
    document

  const model = findModelTrigger([
    '[data-testid*="model"]',
    'button[aria-label*="模型"]',
    'button[aria-label*="Model"]',
  ]) || findButton(/模型|Model/i, root)
  const thinking = findButton(/思考|推理|Reason|Thinking/i, root)
  const webSearch = findButton(/联网|智能搜索|搜索网页|Web search/i, root)

  return [
    model && { id: 'model', label: '模型', type: 'select', element: model },
    thinking && { id: 'thinking', label: '思考', type: 'toggle', element: thinking },
    webSearch && { id: 'webSearch', label: '联网', type: 'toggle', element: webSearch },
  ].filter(Boolean)
}

const PROVIDER_SPECS = {
  chatgpt: {
    version: 'chatgpt-dom-0.3.0',
    composer: [
      '#prompt-textarea',
      'textarea[data-testid="prompt-textarea"]',
      '[contenteditable="true"][aria-label*="ChatGPT"]',
      '.ProseMirror[contenteditable="true"]',
    ],
    send: [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]',
    ],
    messages: [
      {
        selector: '[data-message-author-role]',
        roleAttr: 'data-message-author-role',
        idAttr: 'data-message-id',
      },
      {
        selector: '[class*="user-message"]',
        role: 'user',
        contentSelector:
          '[data-user-message-bubble="true"], [class*="text-size-chat"], .whitespace-pre-wrap',
      },
      { selector: '[class*="MarkdownRoot"]', role: 'assistant' },
    ],
    controls: chatGptControls,
    allowFallback: false,
  },
  claude: {
    version: 'claude-dom-0.3.0',
    composer: [
      '[data-testid="chat-input"]',
      '[contenteditable="true"][aria-label*="Claude"]',
      '.ProseMirror[contenteditable="true"]',
    ],
    send: ['button[aria-label*="发送"]', 'button[aria-label*="Send"]'],
    messages: [
      { selector: '[data-testid="user-message"]', role: 'user' },
      {
        selector: '[data-testid="assistant-message"]',
        role: 'assistant',
        contentSelector: '.standard-markdown',
      },
    ],
    controls: claudeControls,
    allowFallback: false,
  },
  gemini: {
    version: 'gemini-dom-0.3.0',
    composer: [
      '[contenteditable="true"][aria-label*="Gemini"]',
      '.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][placeholder*="Gemini"]',
    ],
    send: ['button[aria-label*="发送"]', 'button[aria-label*="Send"]'],
    messages: [
      {
        selector: 'user-query',
        role: 'user',
        contentSelector: '.query-text, .query-content, [class*="query-text"]',
      },
      {
        selector: 'model-response',
        role: 'assistant',
        contentSelector: '.markdown, message-content, .response-content, [class*="markdown"]',
      },
    ],
    controls: geminiControls,
    allowFallback: false,
  },
  grok: {
    version: 'grok-dom-0.3.0',
    composer: [
      '[contenteditable="true"][aria-label*="Grok"]',
      '.tiptap.ProseMirror[contenteditable="true"]',
      'textarea',
    ],
    send: ['button[aria-label*="发送"]', 'button[aria-label*="Send"]', 'button[type="submit"]'],
    messages: [
      {
        selector: '[data-testid="user-message"]',
        role: 'user',
        contentSelector: '.response-content-markdown',
      },
      {
        selector: '[data-testid="assistant-message"]',
        role: 'assistant',
        contentSelector: '.response-content-markdown',
      },
    ],
    controls: grokControls,
    allowFallback: false,
  },
  deepseek: {
    version: 'deepseek-dom-0.3.0',
    composer: ['textarea[placeholder*="DeepSeek"]', 'textarea'],
    send: [
      'div[role="button"].ds-button--primary:not(.ds-button--disabled)',
      'button[aria-label*="发送"]',
    ],
    messages: [
      { selector: '.fbb737a4', role: 'user' },
      { selector: '.ds-assistant-message-main-content', role: 'assistant' },
    ],
    controls: deepSeekControls,
    allowFallback: false,
  },
  doubao: {
    version: 'doubao-dom-0.3.0',
    composer: ['.tiptap.ProseMirror[contenteditable="true"]', '[contenteditable="true"]'],
    send: ['button[aria-label*="发送"]', 'button[type="submit"]'],
    messages: [
      {
        selector: '[data-testid="send_message"]',
        role: 'user',
        contentSelector: '[data-testid="message_text_content"]',
      },
      {
        selector: '[data-testid="receive_message"]',
        role: 'assistant',
        contentSelector: '[data-testid="message_text_content"]',
      },
    ],
    controls: doubaoControls,
    allowFallback: false,
  },
  qwen: {
    version: 'qwen-dom-0.3.0',
    composer: ['[role="textbox"][contenteditable="true"]', 'textarea', '[contenteditable="true"]'],
    send: ['button[aria-label="发送消息"]', 'button[aria-label*="发送"]', 'button[aria-label*="Send"]', 'button[type="submit"]'],
    messages: [
      { selector: '[data-chat-question-wrap]', role: 'user' },
      {
        selector: '[data-chat-answers-wrap]',
        role: 'assistant',
        contentSelector: '#qk-markdown-react, [class*="markdown"]',
      },
    ],
    controls: null,
    allowFallback: false,
  },
  kimi: {
    version: 'kimi-dom-0.3.0',
    composer: ['.chat-input-editor[contenteditable="true"]', '[contenteditable="true"]'],
    send: ['button[aria-label*="发送"]', 'button[aria-label*="Send"]'],
    messages: [
      {
        selector: '.chat-content-item-user',
        role: 'user',
        contentSelector: '.user-content__text, .user-content',
      },
      {
        selector: '.chat-content-item-assistant .markdown-container:not(.toolcall-content-text) .markdown',
        role: 'assistant',
      },
    ],
    controls: kimiControls,
    allowFallback: false,
  },
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!PROVIDER_ID) return false

  if (message?.type === 'KC_GET_INFO') {
    const composer = getComposer()
    sendResponse({
      ok: true,
      provider: PROVIDER_ID,
      adapterVersion: ADAPTER_VERSION,
      url: location.href,
      title: document.title,
      hasComposer: Boolean(composer),
      messageCount: getMessages().length,
    })
    return false
  }

  if (message?.type === 'KC_GET_CONTROLS') {
    getControls()
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '无法读取网页控制项。',
        }),
      )
    return true
  }

  if (message?.type === 'KC_SET_CONTROL') {
    setControl(message.controlId, message.value)
      .then((data) => sendResponse(data))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '无法设置网页控制项。',
        }),
      )
    return true
  }

  if (message?.type === 'KC_GET_TRANSCRIPT') {
    sendResponse({
      ok: true,
      provider: PROVIDER_ID,
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
