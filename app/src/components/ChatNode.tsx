import { useCallback, useEffect, useRef } from 'react'
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { ArrowDown, ArrowUp, Check, Copy, RefreshCw, Square } from 'lucide-react'
import { NodeShell } from '@/components/NodeShell'
import { SelectionPopover } from '@/components/SelectionPopover'
import { ThreadMarkdown } from '@/components/ThreadMarkdown'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { highlightQuote, useSelectionTool, type SelectionPayload } from '@/hooks/use-selection-tool'
import { useNodeChatSender } from '@/hooks/use-node-chat'
import { stopRequest } from '@/lib/request-registry'
import { useCanvasStore } from '@/store/canvas-store'
import type { CanvasNode, ChatMessage, ChatNodeData } from '@/types/canvas'
import { NODE_SIZES } from '@/types/canvas'

function convertMessage(message: ChatMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: [{ type: 'text', text: message.content }],
  }
}

function messageText(appendMessage: AppendMessage): string {
  return appendMessage.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}

function CopyAction({ align = 'start' }: { align?: 'start' | 'end' }) {
  return (
    <ActionBarPrimitive.Copy asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={`size-7 text-muted-foreground ${align === 'end' ? 'ml-auto' : ''}`}
        title="复制消息"
        aria-label="复制消息"
      >
        <AuiIf condition={(state) => state.message.isCopied}>
          <Check className="size-3.5" />
        </AuiIf>
        <AuiIf condition={(state) => !state.message.isCopied}>
          <Copy className="size-3.5" />
        </AuiIf>
      </Button>
    </ActionBarPrimitive.Copy>
  )
}

function UserMessage({ id }: { id: string }) {
  return (
    <MessagePrimitive.Root
      data-role="user"
      data-message-id={id}
      className="flex flex-col items-end gap-1 pl-8"
    >
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-secondary-foreground">
        <MessagePrimitive.Parts>
          {({ part }) => (part.type === 'text' ? <ThreadMarkdown /> : null)}
        </MessagePrimitive.Parts>
      </div>
      <div className="flex h-6 items-center justify-end pr-0.5">
        <ActionBarPrimitive.Root autohide="always" className="flex items-center">
          <CopyAction align="end" />
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage({
  id,
  incomplete,
  waiting,
}: {
  id: string
  incomplete?: boolean
  waiting?: boolean
}) {
  return (
    <MessagePrimitive.Root
      data-role="assistant"
      data-message-id={id}
      className="group/message min-w-0 pr-1 text-foreground"
    >
      {waiting ? (
        <div className="space-y-2 py-1" aria-label="正在生成回答">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : (
        <MessagePrimitive.Parts>
          {({ part }) => (part.type === 'text' ? <ThreadMarkdown /> : null)}
        </MessagePrimitive.Parts>
      )}
      <div className="mt-1 flex h-6 items-center gap-1">
        <ActionBarPrimitive.Root
          hideWhenRunning
          autohide="not-last"
          autohideFloat="single-branch"
          className="flex items-center gap-0.5"
        >
          <CopyAction />
          <ActionBarPrimitive.Reload asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              title="重新生成"
              aria-label="重新生成"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
        {incomplete && <span className="text-xs text-muted-foreground">已停止</span>}
      </div>
    </MessagePrimitive.Root>
  )
}

function ThreadWelcome({ hasSource }: { hasSource: boolean }) {
  const suggestions = hasSource
    ? ['解释这个选段', '归纳这段的论证', '给出一个反例']
    : ['总结当前上下文', '列出关键结论', '还缺哪些信息']

  return (
    <div className="flex flex-col items-start gap-3 py-5">
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((prompt) => (
          <ThreadPrimitive.Suggestion key={prompt} prompt={prompt} send={false} asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
              {prompt}
            </Button>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  )
}

function NodeThread({ node }: { node: CanvasNode & { data: ChatNodeData } }) {
  const data = node.data
  const rootRef = useRef<HTMLDivElement>(null)
  const sendMessage = useNodeChatSender(node.id)
  const pendingInputNodeId = useCanvasStore((state) => state.pendingInputNodeId)
  const setPendingInputHandled = useCanvasStore((state) => state.setPendingInputHandled)
  const focusedNodeId = useCanvasStore((state) => state.focusedNodeId)
  const sourceJump = useCanvasStore((state) => state.sourceJump)
  const createBranch = useCanvasStore((state) => state.createBranch)
  const openSettings = useCanvasStore((state) => state.openSettings)
  const rewindToLastUser = useCanvasStore((state) => state.rewindToLastUser)
  const rewindToMessage = useCanvasStore((state) => state.rewindToMessage)
  const isRunning = data.status === 'streaming'
  const lastMessage = data.messages[data.messages.length - 1]
  const waitingForFirstToken = isRunning && lastMessage?.role === 'assistant' && !lastMessage.content

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = messageText(message)
      if (!text) return
      await sendMessage(text)
    },
    [sendMessage],
  )

  const onCancel = useCallback(async () => {
    stopRequest(node.id)
  }, [node.id])

  const onReload = useCallback(
    async (parentId: string | null) => {
      if (!parentId) return
      const prompt = rewindToMessage(node.id, parentId)
      if (prompt) await sendMessage(prompt)
    },
    [node.id, rewindToMessage, sendMessage],
  )

  const runtime = useExternalStoreRuntime({
    messages: data.messages,
    convertMessage,
    isRunning,
    onNew,
    onCancel,
    onReload,
  })

  const getSource = useCallback((range: Range): SelectionPayload | null => {
    const common = range.commonAncestorContainer
    const element = common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement
    const assistant = element?.closest<HTMLElement>('[data-role="assistant"]')
    if (!assistant) return null
    return {
      quote: range.toString().trim(),
      messageId: assistant.dataset.messageId,
    }
  }, [])

  const { pending, handleMouseUp, close } = useSelectionTool({
    containerRef: rootRef,
    getSource,
  })

  useEffect(() => {
    if (pendingInputNodeId !== node.id || focusedNodeId) return
    let cancelled = false
    let attempts = 0
    let timer = window.setTimeout(function focusComposer() {
      if (cancelled) return
      const input = rootRef.current?.querySelector<HTMLTextAreaElement>('textarea')
      if (input && input.getClientRects().length > 0) {
        input.focus()
        if (document.activeElement === input) {
          setPendingInputHandled()
          return
        }
      }
      if (attempts < 12) {
        attempts += 1
        timer = window.setTimeout(focusComposer, 40)
      }
    }, 90)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [focusedNodeId, node.id, pendingInputNodeId, setPendingInputHandled])

  useEffect(() => {
    if (sourceJump?.nodeId !== node.id || !sourceJump.messageId) return
    const message = rootRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(sourceJump.messageId)}"]`,
    )
    if (!message) return
    message.scrollIntoView({ block: 'center' })
    message.classList.add('is-source-target')
    if (sourceJump.quote) highlightQuote(message, sourceJump.quote)
    const timer = window.setTimeout(() => message.classList.remove('is-source-target'), 2200)
    return () => window.clearTimeout(timer)
  }, [node.id, sourceJump?.nonce, sourceJump?.messageId, sourceJump?.nodeId, sourceJump?.quote])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div ref={rootRef} onMouseUp={handleMouseUp} className="node-thread min-h-0 flex-1">
        <ThreadPrimitive.Root className="chat-thread-root mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
          <ThreadPrimitive.Viewport className="chat-viewport nowheel min-h-0 flex-1 overflow-y-auto">
            <div className="flex min-h-full flex-col">
              <div className="flex flex-1 flex-col gap-3 px-3 pb-4 pt-3">
                <AuiIf condition={(state) => state.thread.isEmpty && state.composer.isEmpty}>
                  <ThreadWelcome hasSource={Boolean(data.source)} />
                </AuiIf>

                <ThreadPrimitive.Messages>
                  {({ message }) =>
                    message.role === 'user' ? (
                      <UserMessage id={message.id} />
                    ) : (
                      <AssistantMessage
                        id={message.id}
                        incomplete={data.messages.find((entry) => entry.id === message.id)?.incomplete}
                        waiting={waitingForFirstToken && message.id === lastMessage?.id}
                      />
                    )
                  }
                </ThreadPrimitive.Messages>
              </div>

              <ThreadPrimitive.ViewportFooter className="chat-composer-footer relative sticky bottom-0 z-10 mt-auto border-t bg-card px-3 pb-3 pt-2">
                <ThreadPrimitive.ScrollToBottom asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="absolute -top-9 right-3 size-7 rounded-full bg-card text-muted-foreground shadow-sm"
                  title="回到底部"
                  aria-label="回到底部"
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </ThreadPrimitive.ScrollToBottom>

              {data.error && (
                <div
                  role="alert"
                  className="mb-2 flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
                >
                  <span>{data.error}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-destructive hover:text-destructive"
                      onClick={() => {
                        const prompt = rewindToLastUser(node.id)
                        if (prompt) void sendMessage(prompt)
                      }}
                    >
                      重试
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-destructive hover:text-destructive"
                      onClick={() => openSettings('model')}
                    >
                      设置
                    </Button>
                  </div>
                </div>
              )}

              {data.contextNote && (
                <p className="mb-1 text-xs leading-5 text-muted-foreground">{data.contextNote}</p>
              )}

              <ComposerPrimitive.Root
                compact
                className="nodrag nowheel flex items-end gap-1 rounded-xl border bg-background p-1.5 shadow-xs transition-colors focus-within:border-ring"
              >
                <ComposerPrimitive.Input
                  rows={1}
                  placeholder={data.source ? '就这段内容继续追问' : '输入问题'}
                  className="max-h-32 min-h-9 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[length:var(--content-font-size)] leading-6 shadow-none outline-none placeholder:text-muted-foreground"
                />
                <div className="flex shrink-0 items-center gap-1">
                  <AuiIf condition={(state) => state.thread.isRunning}>
                    <ComposerPrimitive.Cancel asChild>
                      <Button variant="secondary" size="icon-sm" aria-label="停止生成">
                        <Square className="size-3.5 fill-current" />
                      </Button>
                    </ComposerPrimitive.Cancel>
                  </AuiIf>
                  <AuiIf condition={(state) => !state.thread.isRunning}>
                    <ComposerPrimitive.Send asChild>
                      <Button size="icon-sm" aria-label="发送消息">
                        <ArrowUp className="size-4" />
                      </Button>
                    </ComposerPrimitive.Send>
                  </AuiIf>
                </div>
              </ComposerPrimitive.Root>
            </ThreadPrimitive.ViewportFooter>
            </div>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>

        <SelectionPopover
          selection={pending}
          onClose={close}
          onAsk={(selection) => {
            createBranch(node.id, {
              quote: selection.quote,
              parentMessageId: selection.messageId,
            })
            close()
          }}
        />
      </div>
    </AssistantRuntimeProvider>
  )
}

export function ChatBody({ node }: { node: CanvasNode & { data: ChatNodeData } }) {
  return <NodeThread node={node} />
}

function ChatNodeComponent({ id, selected }: NodeProps<CanvasNode>) {
  const node = useCanvasStore((state) => state.nodes.find((entry) => entry.id === id))
  if (!node || node.data.kind !== 'chat') return null

  return (
    <>
      <NodeResizer
        minWidth={NODE_SIZES.chat.minWidth}
        minHeight={NODE_SIZES.chat.minHeight}
        isVisible={Boolean(selected)}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <NodeShell node={node} selected={Boolean(selected)} mode="canvas">
        <NodeThread node={node as CanvasNode & { data: ChatNodeData }} />
      </NodeShell>
    </>
  )
}

export default ChatNodeComponent
