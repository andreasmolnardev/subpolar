import { AsyncLocalStorage } from 'node:async_hooks'

export type PiRunContext = {
  baseUrl: string
  internalToken: string
  agentId: string
  sessionId: string
  runId: string
  skills: Array<{ name: string; description: string; filePath: string; baseDir: string }>
}

const storage = new AsyncLocalStorage<PiRunContext>()

export function getPiRunContext(): PiRunContext | undefined {
  return storage.getStore()
}

export function runWithPiContext<T>(context: PiRunContext, callback: () => T): T {
  return storage.run(context, callback)
}
