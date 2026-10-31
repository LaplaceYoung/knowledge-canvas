import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle, X } from 'lucide-react'
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
  onCreateWeb: (providerId: WebProviderId, position: CreateMenuPosition) => void
}

export function NodeCreateMenu({ position, onClose, onCreateWeb }: NodeCreateMenuProps) {
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
  const height = 360
  const left = Math.max(12, Math.min(position.x, window.innerWidth - width - 12))
  const top = Math.max(12, Math.min(position.y, window.innerHeight - height - 12))

  return createPortal(
    <div
      ref={menuRef}
      role="dialog"
      aria-label="连接网页"
      className="fixed z-[60] flex max-h-[calc(100vh-24px)] w-[388px] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
      style={{ left, top }}
    >
      <div className="flex h-10 flex-none items-center justify-between border-b px-3">
        <span className="text-sm font-medium">连接网页</span>
        <span className="ml-auto mr-2 flex items-center gap-1 text-[11px] text-muted-foreground">
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
            ? '检测中'
            : extensionState === 'available'
              ? '扩展已连接'
              : '仅快捷入口'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground"
          aria-label="关闭"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-1.5 p-2">
        {WEB_PROVIDER_IDS.map((providerId, index) => {
          const provider = WEB_PROVIDERS[providerId]
          return (
            <button
              key={providerId}
              ref={index === 0 ? firstActionRef : undefined}
              type="button"
              aria-label={provider.label}
              className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left text-[13px] font-medium transition-colors hover:bg-accent"
              onClick={() => onCreateWeb(providerId, position)}
            >
              <ProviderLogo providerId={providerId} className="size-5" />
              <span className="truncate">{provider.label}</span>
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
