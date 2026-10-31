import type { SearchProvider } from '@/types/canvas'

export interface SearchProviderInfo {
  id: SearchProvider
  label: string
  placeholder: string
}

export const SEARCH_PROVIDERS: SearchProviderInfo[] = [
  { id: 'tinyfish', label: 'TinyFish', placeholder: 'tf-...' },
  { id: 'exa', label: 'Exa', placeholder: 'exa-...' },
  { id: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
  { id: 'bocha', label: '博查', placeholder: 'sk-...' },
]
