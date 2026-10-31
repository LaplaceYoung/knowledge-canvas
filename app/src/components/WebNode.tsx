import { useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import {
  ExternalLink,
  Link2,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from 'lucide-react'
import { toast } from 'sonner'
import { Markdown } from '@/components/Markdown'
import { NodeShell } from '@/components/NodeShell'
import { ProviderLogo } from '@/components/ProviderLogo'
import { Button } from '@/components/ui/button'
import {
  bindCurrentWebNode,
  openWebNodePage,
  submitWebPrompt,
  syncWebNode,
  unbindWebNode,
} from '@/lib/web-node-service'
import { getWebProvider, webUrlLabel } from '@/lib/web-providers'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasNode, WebNodeData } from '@/types/canvas'
import { NODE_SIZES } from '@/types/canvas'

const BINDING_LABEL: Record<WebNodeData['bindingState'], string> = {
  unbound: '未绑定',
  opening: '正在打开网页',
  bound: '已绑定',
  'tab-closed': '标签页已关闭',
  'extension-missing': '快捷入口',
  'permission-required': '需要网页登录',
  error: '连接异常',
}

const MIRROR_LABEL: Record<WebNodeData['mirrorState'], string> = {
  unavailable: '仅标签页联动',
  ready: '镜像就绪',
  submitting: '提交中',
  answering: '网页回答中',
  'needs-login': '需要登录',
  stale: '网页已变化',
  unknown: '状态未知',
  error: '镜像异常',
}

interface WebBodyProps {
  node: CanvasNode & { data: WebNodeData }
  mode: 'canvas' | 'focus'
}

export function WebBody({ node }: WebBodyProps) {
  const data = node.data
  const provider = getWebProvider(data.providerId)
  const updateWebNodeData = useCanvasStore((state) => state.updateWebNodeData)
  const [text, setText] = useState(data.draft ?? '')
  const [activating, setActivating] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const mirrored = data.syncMode === 'dom-mirror' && data.bindingState === 'bound'
  const pending = data.mirrorState === 'submitting' || data.mirrorState === 'answering'
  const canSubmit = mirrored && data.mirrorState === 'ready' && !data.pendingRequestId && !pending
  const canBind = data.bindingState !== 'bound' && data.bindingState !== 'opening'
  const hasMessages = data.visibleMessages.length > 0

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
    else toast.success('已绑定网页标签页。')
  }

  const handleSync = async () => {
    setSyncing(true)
    const result = await syncWebNode(node.id)
    setSyncing(false)
    if (!result.ok) toast.error(result.error || '同步网页失败。')
    else toast.success('已同步网页可见消息。')
  }

  const handleUnbind = async () => {
    await unbindWebNode(node.id)
    toast.success('已解除网页绑定。网页标签页不会关闭。')
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
      <div className="web-toolbar flex h-9 flex-none items-center gap-1.5 border-b px-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ProviderLogo providerId={data.providerId} className="size-3.5" />
          <span className="shrink-0 text-foreground">{provider.label}</span>
          <span className="hidden text-border sm:inline" aria-hidden="true">
            /
          </span>
          <span className="truncate">{webUrlLabel(data.conversationUrl)}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {provider.mirrorSupported && data.bindingState === 'bound' && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              title="手动同步网页可见消息"
              aria-label="手动同步网页"
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

      <div className="web-state-line flex h-7 flex-none items-center justify-between gap-2 border-b px-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          {data.bindingState === 'opening' && <LoaderCircle className="size-3 animate-spin" />}
          <span>{BINDING_LABEL[data.bindingState]}</span>
          <span className="text-border" aria-hidden="true">
            /
          </span>
          <span className={data.mirrorState === 'error' ? 'text-destructive' : undefined}>
            {MIRROR_LABEL[data.mirrorState]}
          </span>
        </span>
        {data.lastSyncedAt && (
          <span className="shrink-0 tabular-nums">
            {new Date(data.lastSyncedAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>

      {showStatus && (
        <div className="web-error-line flex flex-none items-start justify-between gap-3 border-b px-3 py-2 text-xs leading-5 text-destructive">
          <span className="min-w-0">
            {statusError ||
              (data.mirrorState === 'stale'
                ? '网页可能已变化，本地镜像不再标记为最新。'
                : data.mirrorState === 'unknown'
                  ? '提交状态未知，请先打开原网页核对。'
                  : '网页需要登录或完成验证。')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-destructive hover:text-destructive"
            onClick={handleOpen}
          >
            核对网页
          </Button>
        </div>
      )}

      <div className="web-scroll nowheel min-h-0 flex-1 overflow-y-auto">
        {!hasMessages ? (
          <div className="web-welcome flex flex-col items-start gap-3 px-4 py-5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ProviderLogo providerId={data.providerId} className="size-4" />
              {provider.label}
            </div>
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">
              这个节点连接真实网页会话，不嵌入 iframe。登录、验证码和网页额度由 Provider
              网页处理，画布不会读取 Cookie。
            </p>
            {!provider.mirrorSupported && (
              <p className="text-xs leading-5 text-muted-foreground">
                {provider.label} 当前仅支持标签页联动；请在真实网页中提问。
              </p>
            )}
            {provider.mirrorSupported && (
              <p className="text-xs leading-5 text-muted-foreground">
                镜像只从新会话开始，读取网页可见消息；不等于 Provider 的完整模型上下文。
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={handleOpen}>
                <ExternalLink className="size-3.5" />
                打开真实网页
              </Button>
              {canBind && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void handleBind()}
                >
                  <Link2 className="size-3.5" />
                  绑定现有标签页
                </Button>
              )}
            </div>
            {data.bindingState === 'extension-missing' && (
              <p className="text-xs leading-5 text-muted-foreground">
                未检测到浏览器扩展。安装 Knowledge Canvas Bridge 后刷新画布，再绑定标签页。
              </p>
            )}
          </div>
        ) : (
          <div className="web-messages flex flex-col gap-3 px-3 py-3">
            {data.visibleMessages.map((message) => (
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
                  <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[length:var(--content-font-size)] leading-6 text-secondary-foreground">
                    {message.content}
                  </div>
                ) : (
                  <Markdown>{message.content}</Markdown>
                )}
              </div>
            ))}
            {pending && (
              <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                {data.mirrorState === 'submitting' ? '正在提交到网页' : '正在等待网页回答'}
              </div>
            )}
          </div>
        )}
      </div>

      {mirrored ? (
        <div className="web-composer flex flex-none flex-col gap-1.5 border-t bg-card px-3 pb-3 pt-2">
          <div className="flex items-end gap-1 rounded-xl border bg-background p-1.5 transition-colors focus-within:border-ring">
            <textarea
              value={text}
              rows={2}
              placeholder={canSubmit ? '在真实网页中提问' : '等待网页当前状态可提交'}
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
              aria-label="提交到网页"
              disabled={!canSubmit || !text.trim()}
              onClick={() => void send()}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            提问由 {provider.label} 网页处理，使用网页额度，不调用 BYOK Key。
          </p>
        </div>
      ) : (
        <div className="web-linked-footer flex flex-none items-center justify-between gap-3 border-t bg-card px-3 py-2 text-xs text-muted-foreground">
          <span>仅标签页联动，节点内不开放网页输入。</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1.5 text-xs"
            onClick={handleOpen}
          >
            <ExternalLink className="size-3.5" />
            到原网页提问
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
        <WebBody node={node as CanvasNode & { data: WebNodeData }} mode="canvas" />
      </NodeShell>
    </>
  )
}

export default WebNodeComponent
