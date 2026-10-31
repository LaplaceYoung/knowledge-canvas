import type { CanvasNode, CanvasViewport } from '@/types/canvas'

export interface CanvasExportDocument {
  schemaVersion: 1
  exportedAt: string
  activeCanvasId: string
  title: string
  viewport: CanvasViewport
  nodes: CanvasNode[]
}

export function buildCanvasExportDocument(
  title: string,
  activeCanvasId: string,
  viewport: CanvasViewport,
  nodes: CanvasNode[],
): CanvasExportDocument {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    activeCanvasId,
    title,
    viewport,
    nodes,
  }
}

export function canvasToMarkdown(doc: CanvasExportDocument): string {
  const lines: string[] = [`# ${doc.title}`, '']
  lines.push(`Exported at ${doc.exportedAt}`, '')

  for (const node of doc.nodes) {
    lines.push(`## ${node.data.title}`, '')
    lines.push(`- Type: ${node.data.kind}`)
    if (node.data.parentId) lines.push(`- Parent: ${node.data.parentId}`)
    if (node.data.kind === 'web') {
      lines.push(`- Provider: ${node.data.providerId}`)
      if (node.data.conversationUrl) lines.push(`- URL: ${node.data.conversationUrl}`)
    }
    if (node.data.kind === 'document') lines.push(`- File: ${node.data.fileName}`)
    if (node.data.source?.quote) lines.push(`- Source: ${node.data.source.parentTitle} · ${node.data.source.quote}`)
    lines.push('')

    if (node.data.kind === 'chat') {
      for (const message of node.data.messages) {
        lines.push(`### ${message.role === 'user' ? 'User' : 'Assistant'}`, '', message.content, '')
      }
    } else if (node.data.kind === 'web') {
      for (const message of node.data.visibleMessages) {
        lines.push(`### ${message.role === 'user' ? 'User' : 'Assistant'}`, '', message.content, '')
      }
    } else {
      lines.push(node.data.text, '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export function serializeCanvasNodeForHtml(node: CanvasNode): string {
  const data = node.data.kind === 'chat'
    ? node.data.messages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      }))
    : node.data.kind === 'web'
      ? node.data.visibleMessages.map((message) => ({
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        }))
      : [{ role: 'document', content: node.data.text }]
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function canvasToHtml(doc: CanvasExportDocument): string {
  const nodesJson = doc.nodes
    .map((node) => {
      const size = { width: node.width ?? 480, height: node.height ?? 560 }
      return '  {\n'
        + '    id: ' + JSON.stringify(node.id) + ',\n'
        + '    type: ' + JSON.stringify(node.data.kind) + ',\n'
        + '    title: ' + JSON.stringify(node.data.title) + ',\n'
        + '    x: ' + Number(node.position.x) + ',\n'
        + '    y: ' + Number(node.position.y) + ',\n'
        + '    w: ' + Number(size.width) + ',\n'
        + '    h: ' + Number(size.height) + ',\n'
        + '    parentId: ' + JSON.stringify(node.data.parentId ?? null) + ',\n'
        + '    providerId: ' + JSON.stringify(node.data.kind === 'web' ? node.data.providerId : null) + ',\n'
        + '    url: ' + JSON.stringify(node.data.kind === 'web' ? (node.data.conversationUrl ?? '') : '') + ',\n'
        + '    messages: ' + serializeCanvasNodeForHtml(node) + '\n'
        + '  }'
    })
    .join(',\n')

  const scriptBody = [
    'const stage = document.getElementById("stage");',
    'const padding = 24;',
    'const toolbar = 44;',
    'const minX = Math.min(...nodes.map((node) => node.x), 0) - padding;',
    'const minY = Math.min(...nodes.map((node) => node.y), 0) - padding;',
    'const maxX = Math.max(...nodes.map((node) => node.x + node.w), 0) + padding;',
    'const maxY = Math.max(...nodes.map((node) => node.y + node.h), 0) + padding;',
    'const scale = Math.min(',
    '  (innerWidth - padding * 2) / Math.max(1, maxX - minX),',
    '  (innerHeight - toolbar - padding * 2) / Math.max(1, maxY - minY),',
    '  1',
    ');',
    'const nodesById = new Map(nodes.map((node) => [node.id, node]));',
    '',
    'for (const node of nodes) {',
    '  const parent = nodesById.get(node.parentId);',
    '  if (!parent) continue;',
    '  const from = { x: (parent.x + parent.w) * scale, y: (parent.y + parent.h / 2) * scale };',
    '  const to = { x: node.x * scale, y: (node.y + node.h / 2) * scale };',
    '  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");',
    '  svg.setAttribute("class", "edge");',
    '  svg.setAttribute("viewBox", "0 0 " + Math.max(to.x, from.x + 2) + " " + Math.max(innerHeight, toolbar + to.y, toolbar + from.y));',
    '  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");',
    '  path.setAttribute("d", "M " + from.x + " " + from.y + " C " + (from.x + 80) + " " + from.y + ", " + (to.x - 80) + " " + to.y + ", " + to.x + " " + to.y);',
    '  path.setAttribute("stroke", "var(--border)");',
    '  path.setAttribute("stroke-width", "2");',
    '  path.setAttribute("fill", "none");',
    '  svg.appendChild(path);',
    '  stage.appendChild(svg);',
    '}',
    '',
    'for (const node of nodes) {',
    '  const el = document.createElement("article");',
    '  el.className = "node";',
    '  el.style.left = node.x * scale + "px";',
    '  el.style.top = toolbar + node.y * scale + "px";',
    '  el.style.width = Math.max(260, node.w * scale) + "px";',
    '  el.style.height = Math.min(innerHeight - toolbar - 12, Math.max(72, node.h * scale)) + "px";',
    '  const head = document.createElement("h2");',
    '  head.textContent = node.title;',
    '  const meta = document.createElement("div");',
    '  meta.className = "meta";',
    '  meta.textContent = (node.providerId || node.type) + (node.url ? " · " + node.url : "");',
    '  const body = document.createElement("div");',
    '  body.className = "body" + (node.type === "document" ? " doc" : "");',
    '  for (const message of node.messages) {',
    '    const msg = document.createElement("div");',
    '    if (node.type === "document") {',
    '      msg.className = "content";',
    '      msg.textContent = message.content;',
    '    } else {',
    '      const role = message.role === "user" ? "user" : "assistant";',
    '      msg.className = "msg " + role;',
    '      const label = document.createElement("div");',
    '      label.className = "role";',
    '      label.textContent = role;',
    '      const content = document.createElement("div");',
    '      content.className = "content";',
    '      content.textContent = message.content;',
    '      msg.append(label, content);',
    '    }',
    '    body.appendChild(msg);',
    '  }',
    '  el.append(head, meta, body);',
    '  stage.appendChild(el);',
    '}',
  ]

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '  <title>' + escapeHtml(doc.title) + ' — Knowledge Canvas Export</title>',
    '  <style>',
    '    :root { color-scheme: dark; --bg:#0b0e14; --card:#12161e; --text:#f4f1ea; --muted:#94a3b8; --border:#242b38; --accent:#7ea2ff; }',
    '    * { box-sizing: border-box; }',
    '    body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 ui-sans-serif,-apple-system,"SF Pro Text","PingFang SC",sans-serif; }',
    '    .stage { position:relative; width:100vw; height:100vh; overflow:hidden; }',
    '    .node { position:absolute; border:1px solid var(--border); border-radius:10px; background:var(--card); box-shadow:0 10px 30px rgba(0,0,0,.24); display:flex; flex-direction:column; overflow:hidden; }',
    '    .node h2 { margin:0; padding:.55rem .65rem; border-bottom:1px solid var(--border); font-size:13px; font-weight:600; }',
    '    .node .meta { padding:.3rem .65rem; border-bottom:1px solid var(--border); color:var(--muted); font-size:11px; }',
    '    .node .body { min-height:0; overflow:auto; padding:.65rem; }',
    '    .msg { margin-bottom:.8rem; }',
    '    .msg .role { color:var(--muted); font-size:11px; margin-bottom:.15rem; }',
    '    .msg.user { margin-left:16%; padding:.55rem .8rem; background:#202531; border-radius:14px 14px 4px 14px; }',
    '    .msg.assistant .content { white-space:pre-wrap; }',
    '    .content { white-space:pre-wrap; }',
    '    .doc { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; }',
    '    .edge { position:absolute; inset:0; pointer-events:none; }',
    '    .toolbar { position:fixed; inset-inline:0; top:0; z-index:10; display:flex; align-items:center; gap:.7rem; height:44px; padding:0 .9rem; border-bottom:1px solid var(--border); background:rgba(11,14,20,.92); backdrop-filter:blur(10px); }',
    '    .toolbar strong { font-size:14px; }',
    '    .toolbar span { color:var(--muted); font-size:12px; }',
    '    .print { margin-left:auto; border:1px solid var(--border); border-radius:7px; background:var(--card); color:var(--text); padding:.35rem .6rem; cursor:pointer; }',
    '    @media print { .toolbar .print, .toolbar button { display:none; } body { background:#fff; color:#000; } .node { box-shadow:none; } }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="toolbar"><strong>' + escapeHtml(doc.title) + '</strong><span>' + doc.nodes.length + ' nodes · ' + new Date(doc.exportedAt).toLocaleString('zh-CN') + '</span><button class="print" onclick="window.print()">打印 / PDF</button></div>',
    '  <div class="stage" id="stage"></div>',
    '  <script>',
    '    const nodes = [\n' + nodesJson + '\n];',
    scriptBody.join('\n'),
    '  </scr' + 'ipt>',
    '</body>',
    '</html>',
  ].join('\n')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
