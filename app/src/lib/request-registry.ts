const controllers = new Map<string, AbortController>()

export function beginRequest(nodeId: string): AbortController {
  controllers.get(nodeId)?.abort()
  const controller = new AbortController()
  controllers.set(nodeId, controller)
  return controller
}

export function stopRequest(nodeId: string) {
  controllers.get(nodeId)?.abort()
  controllers.delete(nodeId)
}

export function endRequest(nodeId: string, controller: AbortController) {
  if (controllers.get(nodeId) === controller) controllers.delete(nodeId)
}

export function isRequestActive(nodeId: string): boolean {
  return controllers.has(nodeId)
}
