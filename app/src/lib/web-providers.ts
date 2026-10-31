import type { WebProviderId } from '@/types/canvas'
import openaiLogo from '@/assets/providers/openai.svg'
import claudeLogo from '@/assets/providers/claude.svg'
import geminiLogo from '@/assets/providers/gemini.svg'
import grokLogo from '@/assets/providers/grok.svg'
import deepseekLogo from '@/assets/providers/deepseek.svg'
import doubaoLogo from '@/assets/providers/doubao.svg'
import qwenLogo from '@/assets/providers/qwen.svg'
import kimiLogo from '@/assets/providers/kimi.svg'

export const WEB_EXTENSION_ID = 'gnfmgnonoifibmaddbcbkojgcgjnpkej'
export const WEB_EXTENSION_VERSION = '0.2.0'

export interface WebProvider {
  id: WebProviderId
  label: string
  homeUrl: string
  origins: string[]
  logo: string
  monoLogo?: boolean
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
    logo: openaiLogo,
    monoLogo: true,
    mirrorSupported: true,
    adapterVersion: 'chatgpt-dom-0.1',
    note: '新会话可尝试 DOM 镜像；已有会话仅联动真实标签页。',
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    homeUrl: 'https://claude.ai/new',
    origins: ['https://claude.ai'],
    logo: claudeLogo,
    mirrorSupported: false,
    note: '仅打开、聚焦和绑定真实 Claude 标签页。',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    homeUrl: 'https://gemini.google.com/app',
    origins: ['https://gemini.google.com'],
    logo: geminiLogo,
    mirrorSupported: false,
    note: '仅联动 Google Gemini 真实网页。',
  },
  grok: {
    id: 'grok',
    label: 'Grok',
    homeUrl: 'https://grok.com/',
    origins: ['https://grok.com'],
    logo: grokLogo,
    monoLogo: true,
    mirrorSupported: false,
    note: '仅打开和绑定 Grok 真实标签页。',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    homeUrl: 'https://chat.deepseek.com/',
    origins: ['https://chat.deepseek.com'],
    logo: deepseekLogo,
    mirrorSupported: false,
    note: '当前仅联动真实网页，不读取或自动提交页面内容。',
  },
  doubao: {
    id: 'doubao',
    label: '豆包',
    homeUrl: 'https://www.doubao.com/chat/',
    origins: ['https://www.doubao.com', 'https://doubao.com'],
    logo: doubaoLogo,
    mirrorSupported: false,
    note: '仅打开和绑定豆包真实标签页。',
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen',
    homeUrl: 'https://www.qwen.com/',
    origins: ['https://www.qwen.com', 'https://qwen.com', 'https://chat.qwen.ai'],
    logo: qwenLogo,
    mirrorSupported: false,
    note: '仅打开和绑定 Qwen 真实标签页。',
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi',
    homeUrl: 'https://www.kimi.com/',
    origins: ['https://www.kimi.com', 'https://kimi.com'],
    logo: kimiLogo,
    mirrorSupported: false,
    note: '仅打开和绑定 Kimi 真实标签页。',
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
