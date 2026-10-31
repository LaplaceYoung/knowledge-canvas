import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { TextLayer } from '@/types/canvas'

export interface SelectionPayload {
  quote: string
  page?: number
  view?: TextLayer
  messageId?: string
}

interface PendingSelection extends SelectionPayload {
  x: number
  y: number
}

interface UseSelectionToolOptions {
  containerRef: RefObject<HTMLElement | null>
  getSource: (range: Range) => SelectionPayload | null
}

export function useSelectionTool({ containerRef, getSource }: UseSelectionToolOptions) {
  const [pending, setPending] = useState<PendingSelection | null>(null)

  const close = useCallback(() => {
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const handleMouseUp = useCallback(() => {
    requestAnimationFrame(() => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
      const quote = selection.toString().trim()
      if (quote.length < 2 || quote.length > 8_000) return

      const range = selection.getRangeAt(0)
      const common = range.commonAncestorContainer
      const element = common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement
      if (!element || !containerRef.current?.contains(element)) return
      if (element.closest('button, input, textarea, a')) return

      const source = getSource(range)
      if (!source) return
      const rect = range.getBoundingClientRect()
      setPending({
        ...source,
        quote,
        x: Math.min(window.innerWidth - 150, Math.max(12, rect.left + rect.width / 2)),
        y: Math.max(58, rect.top - 10),
      })
    })
  }, [containerRef, getSource])

  useEffect(() => {
    if (!pending) return
    const hide = () => setPending(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPending(null)
        window.getSelection()?.removeAllRanges()
      }
    }
    window.addEventListener('resize', hide)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', hide)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [pending])

  return { pending, handleMouseUp, close }
}

function findTextRange(root: Node, quote: string): Range | null {
  const needle = quote.trim()
  if (!needle) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const content = node.textContent ?? ''
    const index = content.indexOf(needle)
    if (index >= 0) {
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      return range
    }
    node = walker.nextNode()
  }
  return null
}

export function highlightQuote(container: HTMLElement | null, quote: string) {
  if (!container) return false
  const range = findTextRange(container, quote)
  if (!range) return false
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  const rect = range.getBoundingClientRect()
  const scroller = container.closest<HTMLElement>('.chat-viewport, .document-scroll, .node-scroll')
  if (scroller) {
    scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top - 80
  }
  return true
}
