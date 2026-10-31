import type { WebProviderId } from '@/types/canvas'

export const WEB_EXTENSION_ID = 'gnfmgnonoifibmaddbcbkojgcgjnpkej'
export const WEB_EXTENSION_VERSION = '0.1.0'

export interface WebProvider {
  id: WebProviderId
  label: string
  homeUrl: string
  origins: string[]
  mirrorSupported: boolean
  adapterVersion?: string
  note: string
}

export const WEB_PROVIDERS: Record<WebProviderId, WebProvider> = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    homeUrl: 'https://chatgpt.com/',
    origins: ['https://chatgpt.com', 'https://chat.openai.com'],
    mirrorSupported: true,
    adapterVersion: 'chatgpt-dom-0.1',
    note: '新会话可尝试 DOM 镜像；已有会话仅联动真实标签页。',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    homeUrl: 'https://chat.deepseek.com/',
    origins: ['https://chat.deepseek.com'],
    mirrorSupported: false,
    note: '当前仅联动真实网页，不读取或自动提交页面内容。',
  },
}

export const WEB_PROVIDER_IDS = Object.keys(WEB_PROVIDERS) as WebProviderId[]

export function getWebProvider(providerId: WebProviderId): WebProvider {
  return WEB_PROVIDERS[providerId]
}

export function isProviderUrl(providerId: WebProviderId, value: string): boolean {
  try {
    const url = new URL(value)
    return WEB_PROVIDERS[providerId].origins.includes(url.origin)
  } catch {
    return false
  }
}

export function webProviderForUrl(value: string): WebProvider | null {
  return (
    WEB_PROVIDER_IDS.map((id) => WEB_PROVIDERS[id]).find((provider) =>
      provider.origins.some((origin) => value.startsWith(`${origin}/`) || value === origin),
    ) ?? null
  )
}

export function webUrlLabel(value?: string): string {
  if (!value) return '尚未打开'
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return value
  }
}
