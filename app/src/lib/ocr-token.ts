import type { OcrProvider } from '@/types/canvas'

const TOKEN_KEYS: Record<OcrProvider, string> = {
  'paddle-cloud': 'knowledge-canvas-paddleocr-token',
  'self-hosted': 'knowledge-canvas-paddleocr-service-token',
}

export function getOcrToken(provider: OcrProvider): string {
  try {
    return sessionStorage.getItem(TOKEN_KEYS[provider]) ?? ''
  } catch {
    return ''
  }
}

export function setOcrToken(provider: OcrProvider, value: string) {
  try {
    if (value.trim()) {
      sessionStorage.setItem(TOKEN_KEYS[provider], value.trim())
    } else {
      sessionStorage.removeItem(TOKEN_KEYS[provider])
    }
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}
