import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleChatRequest } from './server/chat-proxy.mjs'
import { handleOcrHealth, handleOcrRequest } from './server/ocr-proxy.mjs'

const DIST = fileURLToPath(new URL('./dist', import.meta.url))
const HOST = process.env.HOST?.trim() || '127.0.0.1'
const PORT = Number(process.env.PORT) || 4173

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function sendText(res, status, text) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(text)
}

async function serveStatic(pathname, res) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    sendText(res, 400, 'Bad request')
    return
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const target = resolve(DIST, relative)
  if (target !== DIST && !target.startsWith(`${DIST}${sep}`)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  try {
    const info = await stat(target)
    if (!info.isFile()) throw new Error('not a file')
    res.statusCode = 200
    res.setHeader('Content-Type', MIME_TYPES[extname(target).toLowerCase()] || 'application/octet-stream')
    res.setHeader('Content-Length', info.size)
    res.setHeader('Cache-Control', extname(target) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
    createReadStream(target).pipe(res)
  } catch {
    if (extname(decoded)) {
      sendText(res, 404, 'Not found')
      return
    }
    try {
      const fallback = resolve(DIST, 'index.html')
      const info = await stat(fallback)
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Content-Length', info.size)
      res.setHeader('Cache-Control', 'no-cache')
      createReadStream(fallback).pipe(res)
    } catch {
      sendText(res, 404, 'Build not found. Run npm run build first.')
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (url.pathname === '/api/chat') {
    await handleChatRequest(req, res)
    return
  }
  if (url.pathname === '/api/ocr') {
    await handleOcrRequest(req, res)
    return
  }
  if (url.pathname === '/api/ocr/health' && req.method === 'GET') {
    handleOcrHealth(req, res)
    return
  }
  if (url.pathname.startsWith('/api/')) {
    sendText(res, 404, 'Not found')
    return
  }
  await serveStatic(url.pathname, res)
})

server.listen(PORT, HOST, () => {
  console.log(`Knowledge Canvas server: http://${HOST}:${PORT}`)
})
