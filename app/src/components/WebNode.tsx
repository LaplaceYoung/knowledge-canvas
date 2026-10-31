import { useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import {
  ArrowUp,
  ExternalLink,
  Link2,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from 'lucide-react'
import { toast } from 'sonner'
import { Markdown } from '@/components/Markdown'
import { NodeShell } from '@/components/NodeShell'
import { Button } from '@/components/ui/button'
import {
  bindCurrentWebNode,
  openWebNodePage,
  setWebControl,
  submitWebPrompt,
  syncWebNode,
  unbindWebNode,
} from '@/lib/web-node-service'
import { webUrlLabel } from '@/lib/web-providers'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasNode, WebControl, WebNodeData } from '@/types/canvas'
import { NODE_SIZES } from '@/types/canvas'

const BINDING_LABEL: Record<WebNodeData['bindingState'], string> = {
  unbound: '未绑定',
  opening: '正在打开',
  bound: '已绑定',
  'tab-closed': '标签页已关闭',
  'extension-missing': '快捷入口',
  'permission-required': '需要登录',
  error: '连接异常',
}

const MIRROR_LABEL: Record<WebNodeData['mirrorState'], string> = {
  unavailable: '不可提交',
  ready: '可提交',
  submitting: '提交中',
  answering: '回答中',
  'needs-login': '需要登录',
  stale: '需核对',
  unknown: '状态未知',
  error: '异常',
}

interface WebBodyProps {
  node: CanvasNode & { data: WebNodeData }
}

export function WebBody({ node }: WebBodyProps) {
  const data = node.data
  const updateWebNodeData = useCanvasStore((state) => state.updateWebNodeData)
  const [text, setText] = useState(data.draft ?? '')
  const [activating, setActivating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [controlBusy, setControlBusy] = useState<string | null>(null)

  const mirrored = data.syncMode === 'dom-mirror' && data.bindingState === 'bound'
  const pending = data.mirrorState === 'submitting' || data.mirrorState === 'answering'
  const canSubmit = mirrored && data.mirrorState === 'ready' && !data.pendingRequestId && !pending
  const canBind = data.bindingState !== 'bound' && data.bindingState !== 'opening'
  const hasMessages = data.visibleMessages.length > 0
  const controls = data.controls ?? []
  const lastMessage = data.visibleMessages.at(-1)
  const streamingMessageId =
    data.mirrorState === 'answering' && lastMessage?.role === 'assistant'
      ? lastMessage.id
      : null
  const waitingForFirstMessage = pending && !streamingMessageId

  const setDraft = (value: string) => {
    setText(value)
    updateWebNodeData(node.id, (current) => ({ ...current, draft: value }))
  }

  const handleOpen = () => {
    setActivating(true)
    void openWebNodePage(node.id).finally(() => setActivating(false))
  }

  const handleBind = async () => {
    setActivating(true)
    const result = await bindCurrentWebNode(node.id)
    setActivating(false)
    if (!result.ok) toast.error(result.error || '绑定网页失败。')
  }

  const handleSync = async () => {
    setSyncing(true)
    const result = await syncWebNode(node.id)
    setSyncing(false)
    if (!result.ok) toast.error(result.error || '同步网页失败。')
  }

  const handleUnbind = async () => {
    await unbindWebNode(node.id)
  }

  const handleControl = async (control: WebControl) => {
    if (controlBusy) return
    setControlBusy(control.id)
    const next = control.type === 'toggle' ? !control.value : String(control.value)
    const result = await setWebControl(node.id, control.id, next)
    setControlBusy(null)
    if (!result.ok) toast.error(result.error || '设置网页控制项失败。')
  }

  const send = async () => {
    const prompt = text.trim()
    if (!prompt || !canSubmit) return
    const result = await submitWebPrompt(node.id, prompt)
    if (result.ok) {
      setText('')
      updateWebNodeData(node.id, (current) => ({ ...current, draft: '' }))
    } else {
      toast.error(result.error || '网页提交失败。')
      if (result.unknown) {
        toast.warning('结果未知，先在原网页核对，避免重复提问。')
      }
    }
  }

  const statusError = data.mirrorError
  const showStatus =
    Boolean(statusError) ||
    data.mirrorState === 'needs-login' ||
    data.mirrorState === 'stale' ||
    data.mirrorState === 'unknown'

  return (
    <div className="web-body flex min-h-0 flex-1 flex-col">
      <div className="web-toolbar flex h-9 flex-none items-center gap-2 border-b px-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {data.bindingState === 'opening' && <LoaderCircle className="size-3 animate-spin" />}
          <span className="truncate" title={data.conversationUrl}>
            {webUrlLabel(data.conversationUrl)}
          </span>
          <span className="text-border" aria-hidden="true">
            ·
          </span>
          <span className="shrink-0 text-foreground">{BINDING_LABEL[data.bindingState]}</span>
          <span className="text-border" aria-hidden="true">
            ·
          </span>
          <span className={data.mirrorState === 'error' ? 'shrink-0 text-destructive' : 'shrink-0'}>
            {MIRROR_LABEL[data.mirrorState]}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {data.bindingState === 'bound' && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              title="同步网页可见消息"
              aria-label="同步网页可见消息"
              disabled={syncing}
              onClick={() => void handleSync()}
            >
              <RefreshCw className={syncing ? 'animate-spin' : undefined} />
            </Button>
          )}
          {data.bindingState === 'bound' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              title="解除网页绑定（不关闭网页）"
              aria-label="解除网页绑定"
              onClick={() => void handleUnbind()}
            >
              <Unplug />
            </Button>
          ) : canBind ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              title="绑定最近使用的 Provider 标签页"
              aria-label="绑定网页标签页"
              disabled={activating}
              onClick={() => void handleBind()}
            >
              <Link2 />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1.5 text-xs text-muted-foreground"
            onClick={handleOpen}
            disabled={activating}
          >
            <ExternalLink className="size-3.5" />
            打开网页
          </Button>
        </span>
      </div>

      {controls.length > 0 && data.bindingState === 'bound' && (
        <div className="web-controls flex flex-none flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
          {controls.map((control) => {
            if (control.type === 'toggle') {
              return (
                <Button
                  key={control.id}
                  type="button"
                  variant={control.value ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  aria-pressed={Boolean(control.value)}
                  disabled={controlBusy === control.id}
                  onClick={() => void handleControl(control)}
                >
                  {controlBusy === control.id && <LoaderCircle className="size-3 animate-spin" />}
                  {control.label}
                </Button>
              )
            }

            const options = control.options ?? []
            if (options.length < 2) {
              return (
                <span
                  key={control.id}
                  className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {String(control.value)}
                </span>
              )
            }
            return (
              <label
                key={control.id}
                className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                <span>{control.label}</span>
                <select
                  aria-label={control.label}
                  className="max-w-40 bg-transparent text-[11px] text-foreground outline-none"
                  value={String(control.value)}
                  disabled={controlBusy === control.id}
                  onChange={(event) => {
                    const next = event.currentTarget.value
                    if (controlBusy) return
                    setControlBusy(control.id)
                    void setWebControl(node.id, control.id, next)
                      .then((result) => {
                        if (!result.ok) toast.error(result.error || '设置网页控制项失败。')
                      })
                      .finally(() => setControlBusy(null))
                  }}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>
      )}

      {showStatus && (
        <div className="web-error-line flex flex-none items-start justify-between gap-3 border-b px-3 py-2 text-xs leading-5 text-destructive">
          <span className="min-w-0">
            {statusError ||
              (data.mirrorState === 'stale'
                ? '网页可能已变化，请先核对。'
                : data.mirrorState === 'unknown'
                  ? '提交状态未知，请先核对原网页。'
                  : '网页需要登录或完成验证。')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-destructive hover:text-destructive"
            onClick={handleOpen}
          >
            核对
          </Button>
        </div>
      )}

      <div className="web-scroll nowheel min-h-0 flex-1 overflow-y-auto">
        {hasMessages && (
          <div className="web-messages flex flex-col gap-3 px-3 py-3">
            {data.visibleMessages.map((message) => {
              const streaming = message.id === streamingMessageId
              return (
                <div
                  key={message.id}
                  className={
                    message.role === 'user'
                      ? 'flex justify-end pl-8'
                      : 'min-w-0 pr-1 text-[length:var(--content-font-size)] leading-7 text-foreground'
                  }
                  data-role={`web-${message.role}`}
                >
                  {message.role === 'user' ? (
                    <div className="web-user-bubble max-w-[88%] break-words rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[length:var(--content-font-size)] leading-6 text-secondary-foreground">
                      {message.format === 'markdown' ? (
                        <Markdown className="web-user-markdown">{message.content}</Markdown>
                      ) : (
                        <span className="whitespace-pre-wrap">{message.content}</span>
                      )}
                    </div>
                  ) : (
                    <div className={streaming ? 'web-streaming-message' : undefined}>
                      <Markdown>{message.content}</Markdown>
                      {streaming && <span className="web-stream-caret" aria-hidden="true" />}
                    </div>
                  )}
                </div>
              )
            })}
            {waitingForFirstMessage && (
              <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                <span className="web-typing-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                {data.mirrorState === 'submitting' ? '提交中' : '等待回答'}
              </div>
            )}
          </div>
        )}
      </div>

      {mirrored && (
        <div className="web-composer flex flex-none items-end gap-1 border-t bg-card px-3 pb-3 pt-2">
          <textarea
            value={text}
            rows={2}
            placeholder={canSubmit ? '输入问题' : '等待网页状态可提交'}
            disabled={!canSubmit}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            className="nodrag nowheel max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[length:var(--content-font-size)] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />
          <Button
            type="button"
            size="icon-sm"
            aria-label="提交"
            disabled={!canSubmit || !text.trim()}
            onClick={() => void send()}
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

function WebNodeComponent({ id, selected }: NodeProps<CanvasNode>) {
  const node = useCanvasStore((state) => state.nodes.find((entry) => entry.id === id))
  if (!node || node.data.kind !== 'web') return null

  return (
    <>
      <NodeResizer
        minWidth={NODE_SIZES.web.minWidth}
        minHeight={NODE_SIZES.web.minHeight}
        isVisible={Boolean(selected)}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <NodeShell node={node} selected={Boolean(selected)} mode="canvas">
        <WebBody node={node as CanvasNode & { data: WebNodeData }} />
      </NodeShell>
    </>
  )
}

export default WebNodeComponent
