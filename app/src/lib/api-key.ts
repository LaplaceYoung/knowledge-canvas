const KEY = 'knowledge-canvas-api-key'

export function getApiKey(): string {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setApiKey(value: string) {
  if (value.trim()) {
    sessionStorage.setItem(KEY, value.trim())
  } else {
    sessionStorage.removeItem(KEY)
  }
}

export function clearApiKey() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}
