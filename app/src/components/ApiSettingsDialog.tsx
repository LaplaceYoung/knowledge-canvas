import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { getAgentStatus, probeAgent, type AgentProbe, type AgentStatus } from '@/lib/agent-api'
import { getApiKey, setApiKey } from '@/lib/api-key'
import { getOcrToken, setOcrToken } from '@/lib/ocr-token'
import { useCanvasStore } from '@/store/canvas-store'
import type { OcrProvider, SettingsSection } from '@/types/canvas'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelHint: '例如 gpt-4.1-mini' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelHint: '例如 deepseek-chat' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelHint: '例如 provider/model' },
  { id: 'custom', label: '自定义', baseUrl: '', modelHint: 'OpenAI-compatible 模型名' },
] as const

const OCR_MODELS = ['PP-OCRv6', 'PP-OCRv5'] as const

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

export function ApiSettingsDialog() {
  const open = useCanvasStore((state) => state.settingsOpen)
  if (!open) return null
  return <SettingsDialogBody />
}

function SettingsDialogBody() {
  const section = useCanvasStore((state) => state.settingsSection)
  const setSettingsSection = useCanvasStore((state) => state.setSettingsSection)
  const setSettingsOpen = useCanvasStore((state) => state.setSettingsOpen)
  const apiConfig = useCanvasStore((state) => state.apiConfig)
  const setApiConfig = useCanvasStore((state) => state.setApiConfig)
  const ocrConfig = useCanvasStore((state) => state.ocrConfig)
  const setOcrConfig = useCanvasStore((state) => state.setOcrConfig)
  const contentFontSize = useCanvasStore((state) => state.contentFontSize)
  const setContentFontSize = useCanvasStore((state) => state.setContentFontSize)

  const [presetId, setPresetId] = useState(
    () => PRESETS.find((preset) => preset.baseUrl === apiConfig.baseUrl)?.id ?? 'custom',
  )
  const [baseUrl, setBaseUrl] = useState(apiConfig.baseUrl)
  const [model, setModel] = useState(apiConfig.model)
  const [apiKey, setApiKeyValue] = useState(getApiKey)
  const [showApiKey, setShowApiKey] = useState(false)

  const [ocrProvider, setOcrProvider] = useState<OcrProvider>(ocrConfig.provider)
  const [ocrModel, setOcrModel] = useState(ocrConfig.model)
  const [ocrEndpoint, setOcrEndpoint] = useState(ocrConfig.endpoint)
  const [ocrAutoRun, setOcrAutoRun] = useState(ocrConfig.autoRun)
  const [ocrTokenValue, setOcrTokenValue] = useState(() => getOcrToken(ocrConfig.provider))
  const [showOcrToken, setShowOcrToken] = useState(false)
  const [fontSize, setFontSize] = useState(contentFontSize)

  const [modelError, setModelError] = useState<string>()
  const [ocrError, setOcrError] = useState<string>()
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null)
  const [agentProbe, setAgentProbe] = useState<AgentProbe | null>(null)
  const [agentError, setAgentError] = useState<string>()
  const [agentBusy, setAgentBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAgentStatus()
      .then((status) => {
        if (!cancelled) setAgentStatus(status)
      })
      .catch((error) => {
        if (!cancelled) setAgentError(error instanceof Error ? error.message : '无法读取 Agent 状态。')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveModel = () => {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    if (!isHttpUrl(normalized)) {
      setModelError('Base URL 需要是有效的 http(s) 地址，例如 https://api.openai.com/v1。')
      return
    }
    if (!model.trim()) {
      setModelError('填写模型名称。')
      return
    }
    const preset = PRESETS.find((entry) => entry.id === presetId)
    setApiConfig({
      baseUrl: normalized,
      model: model.trim(),
      providerLabel: preset?.label ?? '自定义',
    })
    setApiKey(apiKey)
    setSettingsOpen(false)
  }

  const saveOcr = () => {
    if (ocrProvider === 'paddle-cloud') {
      if (!OCR_MODELS.includes(ocrModel as (typeof OCR_MODELS)[number])) {
        setOcrError('选择 PP-OCRv6 或 PP-OCRv5。')
        return
      }
    } else {
      const endpoint = ocrEndpoint.trim()
      if (!isHttpUrl(endpoint)) {
        setOcrError('自建服务地址需要是有效的 http(s) 地址，例如 http://127.0.0.1:8080/ocr。')
        return
      }
    }
    setOcrConfig({
      provider: ocrProvider,
      model: ocrModel,
      endpoint: ocrEndpoint.trim(),
      autoRun: ocrAutoRun,
    })
    setOcrToken(ocrProvider, ocrTokenValue)
    setSettingsOpen(false)
  }

  const switchOcrProvider = (provider: OcrProvider) => {
    setOcrProvider(provider)
    setOcrTokenValue(getOcrToken(provider))
    setShowOcrToken(false)
    setOcrError(undefined)
  }

  const saveDisplay = () => {
    setContentFontSize(fontSize)
    setSettingsOpen(false)
  }

  const checkAgent = async () => {
    setAgentBusy(true)
    setAgentError(undefined)
    setAgentProbe(null)
    try {
      const result = await probeAgent()
      setAgentProbe(result)
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Agent 检测失败。')
    } finally {
      setAgentBusy(false)
    }
  }

  const saveCurrent = () => {
    if (section === 'model') saveModel()
    else if (section === 'ocr') saveOcr()
    else saveDisplay()
  }

  return (
    <Dialog open onOpenChange={setSettingsOpen}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>工作区设置</DialogTitle>
          <DialogDescription>
            模型、OCR、本机 Agent 与阅读字号独立配置。模型请求经同源代理转发，不再依赖浏览器 CORS。
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={section}
          onValueChange={(value) => setSettingsSection(value as SettingsSection)}
          className="gap-3"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="model">模型</TabsTrigger>
            <TabsTrigger value="ocr">OCR</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
            <TabsTrigger value="display">显示</TabsTrigger>
          </TabsList>

          <TabsContent value="model" className="space-y-4">
            <div className="grid gap-2">
              <span className="text-sm font-medium">服务商</span>
              <div className="grid grid-cols-4 gap-1" role="group" aria-label="模型服务商">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    size="sm"
                    variant={presetId === preset.id ? 'default' : 'outline'}
                    onClick={() => {
                      setPresetId(preset.id)
                      if (preset.baseUrl) setBaseUrl(preset.baseUrl)
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <label htmlFor="api-base-url" className="text-sm font-medium">
                Base URL
              </label>
              <Input
                id="api-base-url"
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value)
                  setPresetId('custom')
                }}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                填到版本路径为止，例如 <code className="rounded bg-muted px-1">/v1</code>。完整填到{' '}
                <code className="rounded bg-muted px-1">/chat/completions</code> 也可以。
              </p>
            </div>

            <div className="grid gap-2">
              <label htmlFor="api-model" className="text-sm font-medium">
                模型
              </label>
              <Input
                id="api-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={PRESETS.find((entry) => entry.id === presetId)?.modelHint}
                spellCheck={false}
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="api-key" className="text-sm font-medium">
                API Key
              </label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKeyValue(event.target.value)}
                  placeholder="sk-...，本地服务可留空"
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setShowApiKey((value) => !value)}
                >
                  {showApiKey ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>

            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              Key 只保存在当前标签页的 sessionStorage。请求由本地 <code>/api/chat</code> 转发，避免第三方
              CORS 限制；代理不会把 Key 写入磁盘或日志。
            </p>

            {modelError && <p className="text-sm text-destructive">{modelError}</p>}
          </TabsContent>

          <TabsContent value="ocr" className="space-y-4">
            <div className="grid gap-2">
              <span className="text-sm font-medium">OCR 模式</span>
              <div className="grid grid-cols-2 gap-1" role="group" aria-label="OCR 模式">
                <Button
                  type="button"
                  size="sm"
                  variant={ocrProvider === 'paddle-cloud' ? 'default' : 'outline'}
                  onClick={() => switchOcrProvider('paddle-cloud')}
                >
                  PaddleOCR 云端
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={ocrProvider === 'self-hosted' ? 'default' : 'outline'}
                  onClick={() => switchOcrProvider('self-hosted')}
                >
                  自建服务
                </Button>
              </div>
            </div>

            {ocrProvider === 'paddle-cloud' ? (
              <>
                <div className="grid gap-2">
                  <label htmlFor="ocr-token" className="text-sm font-medium">
                    AI Studio Access Token
                  </label>
                  <div className="relative">
                    <Input
                      id="ocr-token"
                      type={showOcrToken ? 'text' : 'password'}
                      value={ocrTokenValue}
                      onChange={(event) => setOcrTokenValue(event.target.value)}
                      placeholder="留空则使用服务端 PADDLEOCR_ACCESS_TOKEN"
                      autoComplete="off"
                      spellCheck={false}
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                      aria-label={showOcrToken ? '隐藏 OCR Token' : '显示 OCR Token'}
                      onClick={() => setShowOcrToken((value) => !value)}
                    >
                      {showOcrToken ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  <a
                    href="https://aistudio.baidu.com/account/accessToken"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="w-fit text-xs text-ring underline underline-offset-2"
                  >
                    获取 AI Studio Access Token
                  </a>
                </div>

                <div className="grid gap-2">
                  <label htmlFor="ocr-model" className="text-sm font-medium">
                    OCR 模型
                  </label>
                  <Select value={ocrModel} onValueChange={setOcrModel}>
                    <SelectTrigger id="ocr-model" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PP-OCRv6">PP-OCRv6</SelectItem>
                      <SelectItem value="PP-OCRv5">PP-OCRv5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-2">
                  <label htmlFor="ocr-endpoint" className="text-sm font-medium">
                    服务地址
                  </label>
                  <Input
                    id="ocr-endpoint"
                    value={ocrEndpoint}
                    onChange={(event) => setOcrEndpoint(event.target.value)}
                    placeholder="http://127.0.0.1:8080/ocr"
                    spellCheck={false}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    指向 PaddleX 的 <code className="rounded bg-muted px-1">POST /ocr</code>。只填主机时会自动补上{' '}
                    <code className="rounded bg-muted px-1">/ocr</code>。
                  </p>
                </div>

                <div className="grid gap-2">
                  <label htmlFor="ocr-service-token" className="text-sm font-medium">
                    访问令牌（可选）
                  </label>
                  <Input
                    id="ocr-service-token"
                    type="password"
                    value={ocrTokenValue}
                    onChange={(event) => setOcrTokenValue(event.target.value)}
                    placeholder="留空则不发送 Authorization"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
              <div className="grid gap-0.5">
                <label htmlFor="ocr-auto-run" className="text-sm font-medium">
                  导入扫描件后自动识别
                </label>
                <span className="text-xs leading-5 text-muted-foreground">
                  默认关闭。开启后只对没有文本层的页面调用 OCR。
                </span>
              </div>
              <Switch id="ocr-auto-run" checked={ocrAutoRun} onCheckedChange={setOcrAutoRun} />
            </div>

            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              OCR 会把页面图片上传到所选服务，云端接口可能产生费用。识别结果按页保存，可随时停止；
              Token 只保存在当前标签页。
            </p>

            {ocrError && <p className="text-sm text-destructive">{ocrError}</p>}
          </TabsContent>

          <TabsContent value="agent" className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-0.5">
                <span className="text-sm font-medium">ACP 本机 Agent</span>
                <span className="text-xs leading-5 text-muted-foreground">
                  通过服务端启动本机 Agent，验证 ACP 初始化与会话创建。
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={agentBusy || !agentStatus?.configured}
                onClick={() => void checkAgent()}
              >
                {agentBusy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CheckCircle2 />
                )}
                检测连接
              </Button>
            </div>

            {agentStatus ? (
              <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 rounded-md border px-3 py-2.5 text-xs">
                <dt className="text-muted-foreground">配置</dt>
                <dd>{agentStatus.configured ? '已配置' : '未配置'}</dd>
                <dt className="text-muted-foreground">命令</dt>
                <dd className="min-w-0 break-all">{agentStatus.command || '未设置'}</dd>
                <dt className="text-muted-foreground">参数</dt>
                <dd>{agentStatus.argsCount} 个</dd>
                <dt className="text-muted-foreground">工作目录</dt>
                <dd className="min-w-0 break-all">
                  {agentStatus.cwd}
                  {!agentStatus.cwdExists && (
                    <span className="ml-1 text-destructive">（目录不存在）</span>
                  )}
                </dd>
                <dt className="text-muted-foreground">协议</dt>
                <dd>{agentStatus.protocol}</dd>
              </dl>
            ) : (
              !agentError && <p className="text-xs text-muted-foreground">读取 Agent 配置中…</p>
            )}

            {!agentStatus?.configured && (
              <div className="space-y-2 rounded-md bg-muted/50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                <p>在服务端 `.env` 或启动环境里配置，浏览器不能提交任意命令：</p>
                <pre className="overflow-x-auto rounded bg-background px-2 py-1.5 text-[11px] leading-5 text-foreground">{`KC_ACP_COMMAND=/absolute/path/to/acp-agent
KC_ACP_ARGS=[]
KC_ACP_CWD=/absolute/workspace/path`}</pre>
                <p>修改后重启开发服务或 `server.mjs`。</p>
              </div>
            )}

            {agentProbe && (
              <div className="space-y-3 rounded-md border px-3 py-3 text-xs">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4 text-ring" />
                  Agent 已响应
                </div>
                <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5">
                  <dt className="text-muted-foreground">实现</dt>
                  <dd>
                    {agentProbe.agent?.title ||
                      agentProbe.agent?.name ||
                      '未提供名称'}
                    {agentProbe.agent?.version ? ` · ${agentProbe.agent.version}` : ''}
                  </dd>
                  <dt className="text-muted-foreground">协议</dt>
                  <dd>ACP v{agentProbe.protocolVersion}</dd>
                  <dt className="text-muted-foreground">会话</dt>
                  <dd>
                    {agentProbe.sessionCreated ? '已创建' : '未创建'}
                    {agentProbe.sessionError ? ` · ${agentProbe.sessionError}` : ''}
                  </dd>
                  <dt className="text-muted-foreground">认证</dt>
                  <dd>
                    {agentProbe.authMethods.length
                      ? agentProbe.authMethods
                          .map((method) => method.name || method.type)
                          .join('、')
                      : '无需额外认证'}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(agentProbe.capabilities)
                    .filter(([, supported]) => supported)
                    .map(([key]) => (
                      <span key={key} className="rounded border bg-muted/40 px-1.5 py-0.5">
                        {key}
                      </span>
                    ))}
                  {!Object.values(agentProbe.capabilities).some(Boolean) && (
                    <span className="text-muted-foreground">只声明了基础 ACP 能力</span>
                  )}
                </div>
              </div>
            )}

            {agentError && <p className="text-sm text-destructive">{agentError}</p>}

            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
              连接检测只做 ACP 初始化和会话创建，不发送 prompt。Agent 仍可能初始化自己的项目环境。
              当前阶段尚未把 Agent 接入普通对话执行；正式接入前还需完成独立会话、上游增量、权限和压缩事件验证。
            </p>
          </TabsContent>

          <TabsContent value="display" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <span className="text-sm font-medium">正文字号</span>
                <span className="text-xs text-muted-foreground">
                  影响对话、文档、OCR 文本和输入框。
                </span>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">{fontSize}px</span>
            </div>
            <Slider
              min={12}
              max={20}
              step={1}
              value={[fontSize]}
              onValueChange={([value]) => setFontSize(value)}
              aria-label="正文字号"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>紧凑 12</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs"
                onClick={() => setFontSize(14)}
              >
                恢复默认 14
              </Button>
              <span>宽松 20</span>
            </div>

            <div
              className="rounded-md border bg-card px-4 py-3"
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}
            >
              <p className="font-medium">阅读字号预览</p>
              <p className="mt-1 text-muted-foreground">
                这是一个用于校准阅读密度的示例段落。字号变化会保留 Markdown、代码块和 LaTeX
                的排版关系。
              </p>
              <p className="mt-1 text-muted-foreground">
                Inline math E = mc² and <span className="rounded bg-muted px-1">code</span>.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {section === 'agent' ? (
            <Button onClick={() => setSettingsOpen(false)}>关闭</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                取消
              </Button>
              <Button onClick={saveCurrent}>
                {section === 'model'
                  ? '保存模型配置'
                  : section === 'ocr'
                    ? '保存 OCR 配置'
                    : '保存显示设置'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
