import path from "path"
import { realpathSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from "vite"
import { handleAgentProbe, handleAgentStatus } from "./server/agent-bridge.mjs"
import { handleChatRequest } from "./server/chat-proxy.mjs"
import { handleOcrHealth, handleOcrRequest } from "./server/ocr-proxy.mjs"

type Next = (error?: unknown) => void

function ocrProxyMiddleware(req: IncomingMessage, res: ServerResponse, next: Next) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname
  if (pathname === "/api/agent/status") {
    handleAgentStatus(req, res)
    return
  }
  if (pathname === "/api/agent/probe") {
    void handleAgentProbe(req, res).catch((error) => {
      console.error("[agent-probe]", error)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end("Agent probe error")
      }
    })
    return
  }
  if (pathname === "/api/chat") {
    void handleChatRequest(req, res).catch((error) => {
      console.error("[chat-proxy]", error)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end("Chat proxy error")
      }
    })
    return
  }
  if (pathname === "/api/ocr") {
    void handleOcrRequest(req, res).catch((error) => {
      console.error("[ocr-proxy]", error)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end("OCR proxy error")
      }
    })
    return
  }
  if (pathname === "/api/ocr/health") {
    handleOcrHealth(req, res)
    return
  }
  next()
}

function paddleOcrProxyPlugin(): Plugin {
  return {
    name: "paddleocr-proxy",
    configureServer(server) {
      server.middlewares.use(ocrProxyMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(ocrProxyMiddleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  for (const key of ["PADDLEOCR_ACCESS_TOKEN", "PADDLEOCR_BASE_URL"]) {
    if (!process.env[key] && env[key]) process.env[key] = env[key]
  }

  return {
    base: "./",
    plugins: [paddleOcrProxyPlugin(), tailwindcss(), react()],
    server: {
      port: 3000,
      fs: {
        allow: [
          searchForWorkspaceRoot(process.cwd()),
          path.dirname(realpathSync(path.resolve(__dirname, "node_modules"))),
        ],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
})
