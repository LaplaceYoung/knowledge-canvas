import { useCallback } from 'react'
import { streamChatCompletion } from '@/lib/api'
import { getApiKey } from '@/lib/api-key'
import { buildRequestContext } from '@/lib/context'
import { createId } from '@/lib/id'
import { beginRequest, endRequest } from '@/lib/request-registry'
import { useCanvasStore } from '@/store/canvas-store'

export function useNodeChatSender(nodeId: string) {
  return useCallback(
    async (prompt: string) => {
      const question = prompt.trim()
      if (!question) return

      const state = useCanvasStore.getState()
      const node = state.nodes.find((entry) => entry.id === nodeId)
      if (!node || node.data.kind !== 'chat' || node.data.status === 'streaming') return

      if (!state.apiConfig.baseUrl.trim() || !state.apiConfig.model.trim()) {
        state.openSettings('model')
        state.setChatError(nodeId, '先填写 Base URL 和模型名。本地模型服务可以留空 API Key。')
        return
      }

      let context
      try {
        context = buildRequestContext(state.nodes, nodeId, question)
      } catch {
        state.setChatError(nodeId, '无法读取当前节点的上游上下文。')
        return
      }

      const assistantId = createId('msg')
      state.startExchange(nodeId, question, assistantId, state.apiConfig.model, context.note)
      const controller = beginRequest(nodeId)

      try {
        await streamChatCompletion({
          baseUrl: state.apiConfig.baseUrl,
          model: state.apiConfig.model,
          apiKey: getApiKey(),
          messages: context.messages,
          signal: controller.signal,
          onDelta: (delta) => {
            useCanvasStore.getState().appendAssistantDelta(nodeId, assistantId, delta)
          },
        })
        useCanvasStore.getState().finishAssistant(nodeId, assistantId)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          useCanvasStore.getState().stopAssistant(nodeId, assistantId)
        } else {
          useCanvasStore
            .getState()
            .failAssistant(
              nodeId,
              assistantId,
              error instanceof Error ? error.message : '模型请求失败。',
            )
        }
      } finally {
        endRequest(nodeId, controller)
      }
    },
    [nodeId],
  )
}
