import type { AgentSkillAccess } from '@subpolar/shared'
import type { RuntimeMessage, RuntimeRunInput } from './types'

type RuntimeAgentConfig = {
  systemPrompt?: string | null
  skillAccess: AgentSkillAccess[]
  skills: string[]
}

type CreateRuntimeRunInputOptions = {
  runId: string
  sessionId: string
  agentId: string
  projectId?: string | null
  cwd?: string
  messages: RuntimeMessage[]
  agent?: RuntimeAgentConfig | null
  model?: Record<string, unknown>
}

export function createRuntimeRunInput(options: CreateRuntimeRunInputOptions): RuntimeRunInput {
  const skillAccess = options.agent?.skillAccess.length
    ? options.agent.skillAccess
    : options.agent?.skills.map(id => ({ id, discovery: 'description' as const })) ?? []

  return {
    runId: options.runId,
    sessionId: options.sessionId,
    agentId: options.agentId,
    projectId: options.projectId,
    cwd: options.cwd,
    messages: options.messages,
    model: options.model,
    systemPrompt: options.agent?.systemPrompt ?? undefined,
    skillAccess,
  }
}
