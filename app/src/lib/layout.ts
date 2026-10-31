import type { XYPosition } from '@xyflow/react'
import type { CanvasNode, SourceAnchor } from '@/types/canvas'
import { NODE_SIZES } from '@/types/canvas'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function getNodeSize(node: CanvasNode): { width: number; height: number } {
  const defaults = node.data.kind === 'chat' ? NODE_SIZES.chat : NODE_SIZES.document
  return {
    width: node.measured?.width ?? node.width ?? defaults.width,
    height: node.measured?.height ?? node.height ?? defaults.height,
  }
}

function overlaps(a: Rect, b: Rect, gap = 24): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  )
}

export function findBranchPosition(
  nodes: CanvasNode[],
  parent: CanvasNode,
  size: { width: number; height: number } = NODE_SIZES.chat,
): XYPosition {
  const parentSize = getNodeSize(parent)
  let x = parent.position.x + parentSize.width + 140
  let y = parent.position.y + 36

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const candidate = { x, y, ...size }
    const collision = nodes.some((node) => {
      if (node.id === parent.id) return false
      return overlaps(candidate, { x: node.position.x, y: node.position.y, ...getNodeSize(node) })
    })
    if (!collision) return { x, y }
    y += 48
    if (attempt > 0 && attempt % 8 === 0) x += 24
  }

  return { x, y }
}

export function findFreePosition(
  nodes: CanvasNode[],
  desired: XYPosition,
  size: { width: number; height: number },
): XYPosition {
  let x = desired.x
  let y = desired.y
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = { x, y, ...size }
    const collision = nodes.some((node) =>
      overlaps(candidate, { x: node.position.x, y: node.position.y, ...getNodeSize(node) }),
    )
    if (!collision) return { x, y }
    x += 32
    if (attempt > 0 && attempt % 7 === 0) {
      x -= 224
      y += 64
    }
  }
  return { x, y }
}

export function makeSourceFromSelection(
  parent: CanvasNode,
  quote: string,
  extra: Pick<SourceAnchor, 'page' | 'parentMessageId'> = {},
): SourceAnchor {
  return {
    parentNodeId: parent.id,
    parentTitle: parent.data.title,
    quote: quote.trim(),
    ...extra,
  }
}
