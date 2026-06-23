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
  | { type: 'message.completed'; messageId: string }
  | { type: 'tool.requested'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool.completed'; toolCallId: string; output: unknown }
  | { type: 'tool.failed'; toolCallId: string; error: string }
  | { type: 'run.completed' }
  | { type: 'run.failed'; error: string }

export interface RuntimeAdapter {
  id: RuntimeId
  run(input: RuntimeRunInput): AsyncIterable<RuntimeEvent>
  cancel(runId: string): Promise<void>
}
