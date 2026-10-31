import type { SearchProvider } from '@/types/canvas'

const KEY_PREFIX = 'knowledge-canvas-search-key-'

export function getSearchKey(provider: SearchProvider): string {
  try {
    return sessionStorage.getItem(`${KEY_PREFIX}${provider}`) ?? ''
  } catch {
    return ''
  }
}

export function setSearchKey(provider: SearchProvider, value: string) {
  try {
    if (value.trim()) sessionStorage.setItem(`${KEY_PREFIX}${provider}`, value.trim())
    else sessionStorage.removeItem(`${KEY_PREFIX}${provider}`)
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}
