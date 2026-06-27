export type RuntimeId = 'pi'

export type RuntimeMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: number
  metadata?: Record<string, unknown>
}

export type RuntimeRunInput = {
  runId: string
  sessionId: string
  agentId: string
  projectId?: string | null
  cwd?: string
  messages: RuntimeMessage[]
  systemPrompt?: string
  model?: Record<string, unknown>
  tools?: RuntimeToolDefinition[]
  workspace?: Record<string, unknown>
}

export type RuntimeToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type RuntimeEvent =
  | { type: 'message.delta'; content: string }
  | { type: 'message.reasoning.delta'; content: string }
  | { type: 'message.completed'; messageId: string; model?: string; usage?: RuntimeUsage; reason?: string }
  | { type: 'tool.requested'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool.updated'; toolCallId: string; output: unknown }
  | { type: 'tool.completed'; toolCallId: string; output: unknown; toolName?: string; input?: unknown }
  | { type: 'tool.failed'; toolCallId: string; error: string; toolName?: string; input?: unknown }
  | { type: 'run.completed' }
  | { type: 'run.failed'; error: string }

export type RuntimeUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
  cost?: {
    total?: number
  }
}

export interface RuntimeAdapter {
  id: RuntimeId
  run(input: RuntimeRunInput): AsyncIterable<RuntimeEvent>
  cancel(runId: string): Promise<void>
}
