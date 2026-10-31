import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, FileUp, Globe2, MessageSquarePlus, X } from 'lucide-react'
import { ProviderLogo } from '@/components/ProviderLogo'
import { Button } from '@/components/ui/button'
import { WEB_PROVIDER_IDS, WEB_PROVIDERS } from '@/lib/web-providers'
import type { WebProviderId } from '@/types/canvas'

export interface CreateMenuPosition {
  x: number
  y: number
}

interface NodeCreateMenuProps {
  position: CreateMenuPosition
  title?: string
  onClose: () => void
  onCreateChat: (position: CreateMenuPosition) => void
  onImport: (position: CreateMenuPosition) => void
  onCreateWeb: (providerId: WebProviderId, position: CreateMenuPosition) => void
}

interface Point {
  x: number
  y: number
}

function sign(a: Point, b: Point, c: Point) {
  return (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y)
}

function insideTriangle(point: Point, a: Point, b: Point, c: Point) {
  const d1 = sign(point, a, b)
  const d2 = sign(point, b, c)
  const d3 = sign(point, c, a)
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNegative && hasPositive)
}

function insideRect(point: Point, rect: DOMRect) {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  )
}

export function NodeCreateMenu({
  position,
  title = '新增节点',
  onClose,
  onCreateChat,
  onImport,
  onCreateWeb,
}: NodeCreateMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const webItemRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const safeApexRef = useRef<Point | null>(null)
  const [webOpen, setWebOpen] = useState(false)

  const width = 224
  const height = 188
  const submenuWidth = 300
  const submenuHeight = 196
  const submenuGap = 8
  const left = Math.max(12, Math.min(position.x, window.innerWidth - width - 12))
  const top = Math.max(12, Math.min(position.y, window.innerHeight - height - 12))
  const rightSpace = window.innerWidth - left - width - submenuGap
  const leftSpace = left - submenuGap
  const submenuSide =
    rightSpace >= submenuWidth || rightSpace >= leftSpace ? 'right' : 'left'
  const submenuTop = Math.max(
    -top + 8,
    Math.min(0, window.innerHeight - top - submenuHeight - 12),
  )

  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
  }, [])

  const closeSubmenu = useCallback(() => {
    cancelClose()
    setWebOpen(false)
    safeApexRef.current = null
  }, [cancelClose])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      setWebOpen(false)
      safeApexRef.current = null
    }, 160)
  }, [cancelClose])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    firstActionRef.current?.focus()
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (webOpen) closeSubmenu()
      else onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeSubmenu, onClose, webOpen])

  useEffect(() => () => cancelClose(), [cancelClose])

  useEffect(() => {
    if (!webOpen) return
    const onPointerMove = (event: PointerEvent) => {
      const parent = webItemRef.current
      const submenu = submenuRef.current
      if (!parent || !submenu) return
      const point = { x: event.clientX, y: event.clientY }
      if (
        parent.contains(event.target as Node) ||
        submenu.contains(event.target as Node) ||
        insideRect(point, parent.getBoundingClientRect()) ||
        insideRect(point, submenu.getBoundingClientRect())
      ) {
        cancelClose()
        return
      }

      const apex = safeApexRef.current
      if (apex) {
        const rect = submenu.getBoundingClientRect()
        const nearTop = {
          x: submenuSide === 'right' ? rect.left : rect.right,
          y: rect.top,
        }
        const nearBottom = {
          x: submenuSide === 'right' ? rect.left : rect.right,
          y: rect.bottom,
        }
        if (insideTriangle(point, apex, nearTop, nearBottom)) {
          cancelClose()
          return
        }
      }
      scheduleClose()
    }

    document.addEventListener('pointermove', onPointerMove, true)
    return () => document.removeEventListener('pointermove', onPointerMove, true)
  }, [cancelClose, scheduleClose, submenuSide, webOpen])

  return createPortal(
    <div
      ref={menuRef}
      role="dialog"
      aria-label={title}
      className="fixed z-[60] w-[224px] rounded-lg border bg-popover text-popover-foreground shadow-xl"
      style={{ left, top }}
      onPointerLeave={scheduleClose}
    >
      <div className="flex h-10 items-center justify-between border-b px-3">
        <span className="text-sm font-medium">{title}</span>
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

      <div className="flex flex-col gap-0.5 p-1">
        <Button
          ref={firstActionRef}
          type="button"
          variant="ghost"
          className="h-10 w-full justify-start gap-2 px-2.5 text-[13px] font-normal"
          onClick={() => onCreateChat(position)}
        >
          <MessageSquarePlus className="size-4 text-muted-foreground" />
          新建对话
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-10 w-full justify-start gap-2 px-2.5 text-[13px] font-normal"
          onClick={() => onImport(position)}
        >
          <FileUp className="size-4 text-muted-foreground" />
          上传文件
        </Button>

        <div
          ref={webItemRef}
          className="relative"
          onPointerEnter={() => {
            cancelClose()
            safeApexRef.current = null
            setWebOpen(true)
          }}
          onPointerLeave={(event) => {
            safeApexRef.current = { x: event.clientX, y: event.clientY }
            scheduleClose()
          }}
        >
          <Button
            type="button"
            variant={webOpen ? 'secondary' : 'ghost'}
            className="h-10 w-full justify-start gap-2 px-2.5 text-[13px] font-normal"
            aria-haspopup="menu"
            aria-expanded={webOpen}
            onFocus={() => {
              cancelClose()
              setWebOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                cancelClose()
                setWebOpen(true)
              }
            }}
            onClick={() => {
              cancelClose()
              setWebOpen(true)
            }}
          >
            <Globe2 className="size-4 text-muted-foreground" />
            Web 节点
            <ChevronRight className="ml-auto size-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {webOpen && (
        <div
          ref={submenuRef}
          role="menu"
          aria-label="Web 节点"
          className="absolute z-10 grid grid-cols-2 gap-1 rounded-lg border bg-popover p-2 shadow-xl"
          style={{
            width: submenuWidth,
            top: submenuTop,
            ...(submenuSide === 'right'
              ? { left: width + submenuGap }
              : { right: width + submenuGap }),
          }}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
        >
          {WEB_PROVIDER_IDS.map((providerId) => {
            const provider = WEB_PROVIDERS[providerId]
            return (
              <button
                key={providerId}
                type="button"
                role="menuitem"
                aria-label={provider.label}
                className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] font-medium transition-colors hover:bg-accent"
                onClick={() => onCreateWeb(providerId, position)}
              >
                <ProviderLogo providerId={providerId} className="size-5" />
                <span className="truncate">{provider.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>,
    document.body,
  )
}
