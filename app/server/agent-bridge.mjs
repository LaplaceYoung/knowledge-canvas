import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { Buffer } from 'node:buffer'
import {
  PROTOCOL_VERSION,
  client,
  methods,
  ndJsonStream,
} from '@agentclientprotocol/sdk'

const PROBE_TIMEOUT_MS = 30_000
const MAX_STDERR = 4_000

class AgentBridgeError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'AgentBridgeError'
    this.code = code
    this.status = status
  }
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function readConfig() {
  const command = process.env.KC_ACP_COMMAND?.trim() || ''
  const cwd = process.env.KC_ACP_CWD?.trim() || process.cwd()
  let args = []
  const rawArgs = process.env.KC_ACP_ARGS?.trim()
  if (rawArgs) {
    try {
      const parsed = JSON.parse(rawArgs)
      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
        throw new Error('KC_ACP_ARGS must be a JSON array of strings.')
      }
      args = parsed
    } catch (error) {
      throw new AgentBridgeError(
        'INVALID_ACP_ARGS',
        error instanceof Error ? error.message : 'KC_ACP_ARGS must be a JSON array of strings.',
      )
    }
  }

  return {
    command,
    args,
    cwd,
    configured: Boolean(command),
  }
}

function publicStatus() {
  const config = readConfig()
  return {
    configured: config.configured,
    command: config.command ? basename(config.command) : null,
    argsCount: config.args.length,
    cwd: config.cwd,
    cwdExists: existsSync(config.cwd) && statSync(config.cwd).isDirectory(),
    protocol: 'ACP v1',
    timeoutMs: PROBE_TIMEOUT_MS,
  }
}

function validateConfig(config) {
  if (!config.configured) {
    throw new AgentBridgeError(
      'ACP_NOT_CONFIGURED',
      '未配置本机 Agent。设置 KC_ACP_COMMAND、KC_ACP_ARGS 和 KC_ACP_CWD 后重启服务。',
      404,
    )
  }
  if (!isAbsolute(config.cwd)) {
    throw new AgentBridgeError('INVALID_ACP_CWD', 'KC_ACP_CWD 必须是绝对路径。')
  }
  if (!existsSync(config.cwd) || !statSync(config.cwd).isDirectory()) {
    throw new AgentBridgeError('INVALID_ACP_CWD', 'KC_ACP_CWD 不存在或不是目录。')
  }
}

function summarizeCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') return {}
  const prompt = capabilities.promptCapabilities ?? {}
  const session = capabilities.sessionCapabilities ?? {}
  return {
    loadSession: Boolean(capabilities.loadSession),
    imagePrompt: Boolean(prompt.image),
    audioPrompt: Boolean(prompt.audio),
    embeddedContext: Boolean(prompt.embeddedContext),
    sessionResume: Boolean(session.resume),
    sessionClose: Boolean(session.close),
  }
}

function summarizeAuth(authMethods) {
  if (!Array.isArray(authMethods)) return []
  return authMethods
    .map((method) => {
      if (!method || typeof method !== 'object') return null
      return {
        type: typeof method.type === 'string' ? method.type : 'unknown',
        name: typeof method.name === 'string' ? method.name : undefined,
      }
    })
    .filter(Boolean)
}

async function probeAgent(config) {
  validateConfig(config)
  const child = spawn(config.command, config.args, {
    cwd: config.cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, KC_ACP_CLIENT: 'knowledge-canvas' },
  })

  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-MAX_STDERR)
  })

  const input = Writable.toWeb(child.stdin)
  const output = Readable.toWeb(child.stdout)
  const stream = ndJsonStream(input, output)
  const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers()
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    rejectTimeout(
      new AgentBridgeError('ACP_TIMEOUT', `Agent 在 ${PROBE_TIMEOUT_MS / 1000} 秒内没有完成初始化。`, 504),
    )
  }, PROBE_TIMEOUT_MS)

  const probe = client({
    name: 'knowledge-canvas',
    title: 'Knowledge Canvas',
    version: '0.4.0',
  }).connectWith(stream, async (context) => {
    const initialized = await context.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: {
        name: 'knowledge-canvas',
        title: 'Knowledge Canvas',
        version: '0.4.0',
      },
    })

    let sessionCreated = false
    let sessionError
    try {
      const session = await context.buildSession(config.cwd).start()
      sessionCreated = true
      session.dispose()
    } catch (error) {
      sessionError = error instanceof Error ? error.message : '会话创建失败。'
    }

    return {
      protocolVersion: initialized.protocolVersion,
      agent: initialized.agentInfo ?? null,
      authMethods: summarizeAuth(initialized.authMethods),
      capabilities: summarizeCapabilities(initialized.agentCapabilities),
      sessionCreated,
      sessionError,
    }
  })

  probe.catch(() => undefined)

  try {
    return await Promise.race([probe, timeoutPromise])
  } catch (error) {
    if (error instanceof AgentBridgeError) throw error
    const detail = stderr.trim().slice(-500)
    throw new AgentBridgeError(
      'ACP_PROBE_FAILED',
      `Agent 连接失败。${detail ? ` stderr：${detail}` : error instanceof Error ? ` ${error.message}` : ''}`,
      502,
    )
  } finally {
    clearTimeout(timer)
    child.kill('SIGTERM')
  }
}

export function handleAgentStatus(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET。' } })
    return
  }
  try {
    sendJson(res, 200, publicStatus())
  } catch (error) {
    sendJson(res, 500, {
      error: {
        code: error instanceof AgentBridgeError ? error.code : 'ACP_CONFIG_INVALID',
        message: error instanceof Error ? error.message : 'Agent 配置无效。',
      },
    })
  }
}

export async function handleAgentProbe(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST。' } })
    return
  }
  const contentType = String(req.headers['content-type'] || '')
  if (!contentType.toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, {
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Agent 请求必须使用 application/json。' },
    })
    return
  }
  req.resume()
  try {
    const config = readConfig()
    const result = await probeAgent(config)
    sendJson(res, 200, result)
  } catch (error) {
    sendJson(res, error instanceof AgentBridgeError ? error.status : 502, {
      error: {
        code: error instanceof AgentBridgeError ? error.code : 'ACP_PROBE_FAILED',
        message: error instanceof Error ? error.message : 'Agent 检测失败。',
      },
    })
  }
}
