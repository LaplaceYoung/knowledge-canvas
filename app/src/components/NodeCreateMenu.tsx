import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileUp, LoaderCircle, MessageSquarePlus, X } from 'lucide-react'
import { ProviderLogo } from '@/components/ProviderLogo'
import { Button } from '@/components/ui/button'
import { pingWebBridge } from '@/lib/web-bridge'
import { WEB_PROVIDER_IDS, WEB_PROVIDERS } from '@/lib/web-providers'
import type { WebProviderId } from '@/types/canvas'

export interface CreateMenuPosition {
  x: number
  y: number
}

interface NodeCreateMenuProps {
  position: CreateMenuPosition
  onClose: () => void
  onCreateChat: (position: CreateMenuPosition) => void
  onImport: (position: CreateMenuPosition) => void
  onCreateWeb: (providerId: WebProviderId, position: CreateMenuPosition) => void
}

export function NodeCreateMenu({
  position,
  onClose,
  onCreateChat,
  onImport,
  onCreateWeb,
}: NodeCreateMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const [extensionState, setExtensionState] = useState<'checking' | 'available' | 'missing'>(
    'checking',
  )

  useEffect(() => {
    let cancelled = false
    pingWebBridge().then((result) => {
      if (!cancelled) setExtensionState(result ? 'available' : 'missing')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    firstActionRef.current?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const width = 388
  const height = 520
  const left = Math.max(12, Math.min(position.x, window.innerWidth - width - 12))
  const top = Math.max(12, Math.min(position.y, window.innerHeight - height - 12))

  return createPortal(
    <div
      ref={menuRef}
      role="dialog"
      aria-label="新增节点"
      className="fixed z-[60] flex max-h-[calc(100vh-24px)] w-[388px] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
      style={{ left, top }}
    >
      <div className="flex h-10 flex-none items-center justify-between border-b px-3">
        <span className="text-sm font-medium">新增节点</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground"
          aria-label="关闭新增节点菜单"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-1.5 p-2">
          <button
            ref={firstActionRef}
            type="button"
            className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
            onClick={() => onCreateChat(position)}
          >
            <MessageSquarePlus className="size-4 shrink-0 text-muted-foreground" />
            新建对话
          </button>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
            onClick={() => onImport(position)}
          >
            <FileUp className="size-4 shrink-0 text-muted-foreground" />
            导入文档
          </button>
        </div>

        <div className="flex items-center justify-between border-t px-3 pb-1.5 pt-2">
          <span className="text-xs font-medium text-muted-foreground">Web 节点</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {extensionState === 'checking' ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <span
                className={`size-1.5 rounded-full ${
                  extensionState === 'available' ? 'bg-ring' : 'border border-muted-foreground/60'
                }`}
                aria-hidden="true"
              />
            )}
            {extensionState === 'checking'
              ? '检测扩展'
              : extensionState === 'available'
                ? '扩展已连接'
                : '仅快捷入口'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
          {WEB_PROVIDER_IDS.map((providerId) => {
            const provider = WEB_PROVIDERS[providerId]
            return (
              <button
                key={providerId}
                type="button"
                title={provider.note}
                className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent"
                onClick={() => onCreateWeb(providerId, position)}
              >
                <ProviderLogo providerId={providerId} className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{provider.label}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {provider.mirrorSupported ? '镜像 + 标签页' : '标签页联动'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-none items-start gap-2 border-t px-3 py-2 text-[11px] leading-4 text-muted-foreground">
        <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-ring" aria-hidden="true" />
        <span>
          ChatGPT 新会话支持网页镜像；其他 Provider 只打开和绑定真实标签页，不读取页面内容。
        </span>
      </div>
    </div>,
    document.body,
  )
}
