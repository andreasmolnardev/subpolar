import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { getAuthPath, getPiModelsPath } from '@subpolar/shared/config/env'
import fs from 'fs/promises'
import path from 'path'
import type { RuntimeAdapter, RuntimeEvent, RuntimeRunInput } from './types'
import type { SkillFileInfo } from '@subpolar/shared'
import { buildAgentPrompt } from '../services/agent-prompt'
import { closeMcpSession } from '../services/mcp'
import { runWithPiContext, type PiRunContext } from '../pi/run-context'

type SessionManagerMessage = Parameters<SessionManager['appendMessage']>[0]

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

type PiRuntimeAdapterOptions = {
  baseUrl: string
  internalToken: string
  extensionPath?: string
}

type ActivePiProcess = {
  abort: () => Promise<void>
  dispose: () => void
  sessionId: string
}

type RuntimeSkill = {
  name: string
  description: string
  filePath: string
  baseDir: string
  source?: 'auto-generated'
  toolId?: string
  inputSchema?: Record<string, unknown>
}

type ListedTool = {
  id: string
  description: string
  inputSchema: Record<string, unknown>
}

const defaultExtensionPath = new URL('../pi/extension.ts', import.meta.url).pathname

type PiSdkEvent = {
  type?: string
  message?: {
    id?: string
    model?: string
    stopReason?: string
    usage?: {
      input?: number
      output?: number
      cacheRead?: number
      cacheWrite?: number
      totalTokens?: number
      cost?: {
        total?: number
      }
    }
  }
  assistantMessageEvent?: {
    type?: string
    delta?: string
  }
  toolName?: string
  name?: string
  toolCallId?: string
  id?: string
  input?: unknown
  args?: unknown
  output?: unknown
  result?: unknown
  delta?: unknown
  data?: unknown
  error?: string
  isError?: boolean
  messageId?: string
}

class RuntimeEventQueue {
  private readonly events: RuntimeEvent[] = []
  private readonly waiters: Array<(result: IteratorResult<RuntimeEvent>) => void> = []
  private closed = false

  push(event: RuntimeEvent): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: event, done: false })
      return
    }
    this.events.push(event)
  }

  close(): void {
    this.closed = true
    let waiter = this.waiters.shift()
    while (waiter) {
      waiter({ value: undefined, done: true })
      waiter = this.waiters.shift()
    }
  }

  async *read(): AsyncIterable<RuntimeEvent> {
    while (true) {
      const event = this.events.shift()
      if (event) {
        yield event
        continue
      }
      if (this.closed) return
      const result = await new Promise<IteratorResult<RuntimeEvent>>(resolve => this.waiters.push(resolve))
      if (result.done) return
      yield result.value
    }
  }
}

export class PiRuntimeAdapter implements RuntimeAdapter {
  id = 'pi' as const
  private readonly activeProcesses = new Map<string, ActivePiProcess>()

  constructor(private readonly options: PiRuntimeAdapterOptions) {}

  async *run(input: RuntimeRunInput): AsyncIterable<RuntimeEvent> {
    const queue = new RuntimeEventQueue()
    const sessionResult = await this.createSession(input, queue)
    const { session, context } = sessionResult

    this.activeProcesses.set(input.runId, {
      abort: () => session.abort(),
      dispose: () => session.dispose(),
      sessionId: input.sessionId,
    })

    const run = runWithPiContext(context, () => session.prompt(this.createPromptMessage(input)))
      .then(() => queue.push({ type: 'run.completed' }))
      .catch((error: unknown) => queue.push({
        type: 'run.failed',
        error: error instanceof Error ? error.message : 'Pi runtime failed',
      }))
      .finally(() => {
        queue.close()
        this.activeProcesses.delete(input.runId)
        closeMcpSession(input.sessionId)
        session.dispose()
      })

    void run
    try {
      yield* queue.read()
    } finally {
      await run
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.activeProcesses.get(runId)
    if (!active) return
    await active.abort()
    active.dispose()
    closeMcpSession(active.sessionId)
    this.activeProcesses.delete(runId)
  }

  private async createSession(input: RuntimeRunInput, queue: RuntimeEventQueue) {
    const cwd = input.cwd ?? process.cwd()
    const projectSkillPaths = await this.getProjectSkillPaths(cwd)
    const generatedToolSkills = await this.getGeneratedToolSkills(input.agentId)
    const authStorage = AuthStorage.create(getAuthPath())
    const modelRegistry = ModelRegistry.create(authStorage, getPiModelsPath())
    const modelId = this.getModelArg(input.model)
    const model = modelId ? this.findModel(modelRegistry, modelId) : undefined
    const thinkingLevel = this.getThinkingLevel(input.model)
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      additionalExtensionPaths: [this.options.extensionPath ?? defaultExtensionPath],
      additionalSkillPaths: projectSkillPaths,
      systemPromptOverride: () => systemPrompt,
    })

    await loader.reload()
    const skills = [
      ...await this.getRuntimeSkills(cwd, loader.getSkills().skills),
      ...generatedToolSkills,
    ]
    const systemPrompt = await this.getSystemPrompt(input.systemPrompt, input.skillAccess, cwd, skills)
    await loader.reload()
    const sessionManager = SessionManager.inMemory(cwd)
    this.seedSessionHistory(sessionManager, input)

    const result = await createAgentSession({
      cwd,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel,
      resourceLoader: loader,
      sessionManager,
    })

    result.session.subscribe((event: unknown) => {
      const mapped = this.mapEvent(event as PiSdkEvent)
      if (mapped) queue.push(mapped)
    })

    return {
      ...result,
      context: {
        baseUrl: this.options.baseUrl,
        internalToken: this.options.internalToken,
        agentId: input.agentId,
        sessionId: input.sessionId,
        runId: input.runId,
        skills,
      } satisfies PiRunContext,
    }
  }

  private getModelArg(model: Record<string, unknown> | undefined): string | undefined {
    const providerID = typeof model?.providerID === 'string' ? model.providerID : undefined
    const modelID = typeof model?.modelID === 'string' ? model.modelID : undefined
    if (!providerID || !modelID) return undefined
    return `${providerID}/${modelID}`
  }

  private findModel(modelRegistry: ReturnType<typeof ModelRegistry.create>, modelId: string) {
    const [provider, ...modelParts] = modelId.split('/')
    const id = modelParts.join('/')
    if (!provider || !id) return undefined
    return modelRegistry.find(provider, id)
  }

  private getThinkingLevel(model: Record<string, unknown> | undefined): ThinkingLevel | undefined {
    const value = model?.thinkingLevel
    if (value === 'off' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value
    return undefined
  }

  private async getSystemPrompt(systemPrompt: string | undefined, skillAccess: RuntimeRunInput['skillAccess'], cwd: string, skills: RuntimeSkill[]): Promise<string | undefined> {
    const agentsMdPath = path.join(cwd, 'AGENTS.md')
    const agentsMd = await fs.readFile(agentsMdPath, 'utf8').catch(() => '')
    return buildAgentPrompt({
      agentPrompt: systemPrompt,
      projectInstructions: agentsMd,
      skillAccess,
      skills: skills.map((skill): SkillFileInfo => ({
        name: skill.name,
        description: skill.description,
        body: skill.source === 'auto-generated'
          ? `Load ${skill.name} with skill-load for the tool's full instructions and schema.`
          : '',
        scope: skill.source === 'auto-generated' ? 'global' : 'project',
        location: skill.filePath,
        source: skill.source === 'auto-generated' ? 'auto' : 'project',
      })),
    }).prompt
  }

  private async getProjectSkillPaths(cwd: string): Promise<string[]> {
    const candidates = [
      path.join(cwd, '.opencode', 'skills'),
      path.join(cwd, '.subpolar', 'skills'),
      path.join(cwd, 'skills'),
    ]
    const existing = []
    for (const candidate of candidates) {
      const stat = await fs.stat(candidate).catch(() => null)
      if (stat?.isDirectory()) existing.push(candidate)
    }
    return existing
  }

  private async getRuntimeSkills(cwd: string, loaderSkills: RuntimeSkill[]): Promise<RuntimeSkill[]> {
    const disabled = await this.getDisabledProjectSkills(cwd)
    const projectSkills = await this.findProjectSkills(cwd)
    const skillsByName = new Map<string, RuntimeSkill>()
    for (const skill of loaderSkills) {
      if (!disabled.has(skill.name)) skillsByName.set(skill.name, skill)
    }
    for (const skill of projectSkills) {
      if (!disabled.has(skill.name)) skillsByName.set(skill.name, skill)
    }
    return [...skillsByName.values()]
  }

  private async getGeneratedToolSkills(agentId: string): Promise<RuntimeSkill[]> {
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/+$/, '')}/api/subpolar-cli/tools/list`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.internalToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ agentId }),
      })
      if (!response.ok) return []
      const result = await response.json() as { ok?: unknown; tools?: unknown }
      if (!result.ok || !Array.isArray(result.tools)) return []
      return result.tools.flatMap((tool): RuntimeSkill[] => {
        if (!tool || typeof tool !== 'object') return []
        const { id, description, inputSchema } = tool as Partial<ListedTool>
        if (typeof id !== 'string' || typeof description !== 'string' || !inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return []
        return [{
          name: `tool-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
          description: `Auto-generated skill for ${id}: ${description}`,
          filePath: `subpolar-tool://${id}`,
          baseDir: '',
          source: 'auto-generated',
          toolId: id,
          inputSchema,
        }]
      })
    } catch {
      return []
    }
  }

  private async getDisabledProjectSkills(cwd: string): Promise<Set<string>> {
    const disabled = new Set<string>()
    const skillsDir = path.join(cwd, 'skills')
    const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.disabled')) {
        disabled.add(entry.name.slice(0, -'.disabled'.length))
      }
    }
    return disabled
  }

  private async findProjectSkills(cwd: string): Promise<RuntimeSkill[]> {
    const skills: RuntimeSkill[] = []
    const roots = [
      cwd,
      path.join(cwd, '.subpolar', 'skills'),
      path.join(cwd, 'skills'),
    ]
    const seen = new Set<string>()
    for (const root of roots) {
      for (const filePath of await this.findSkillFiles(root, root === cwd ? 3 : 2)) {
        if (seen.has(filePath)) continue
        seen.add(filePath)
        const content = await fs.readFile(filePath, 'utf8').catch(() => '')
        if (!content.trim()) continue
        skills.push(this.parseSkillFile(filePath, content))
      }
    }
    return skills
  }

  private async findSkillFiles(root: string, maxDepth: number): Promise<string[]> {
    const resolvedRoot = path.resolve(root)
    const stat = await fs.stat(resolvedRoot).catch(() => null)
    if (!stat?.isDirectory()) return []
    const files: string[] = []
    async function visit(dir: string, depth: number): Promise<void> {
      if (depth > maxDepth) return
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await visit(fullPath, depth + 1)
        } else if (entry.name === 'SKILL.md' || (dir === resolvedRoot && entry.name.endsWith('.md'))) {
          files.push(fullPath)
        }
      }
    }
    await visit(resolvedRoot, 0)
    return files
  }

  private parseSkillFile(filePath: string, content: string): RuntimeSkill {
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || path.basename(filePath, '.md')
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
    return {
      name,
      description,
      filePath,
      baseDir: path.dirname(filePath),
    }
  }

  private createPromptMessage(input: RuntimeRunInput): string {
    const lastUserMessage = [...input.messages].reverse().find(message => message.role === 'user')
    return lastUserMessage?.content ?? ''
  }

  private seedSessionHistory(sessionManager: SessionManager, input: RuntimeRunInput): void {
    const lastUserIndex = input.messages.findLastIndex(message => message.role === 'user')
    for (const [index, message] of input.messages.entries()) {
      if (!message.content || index === lastUserIndex) continue
      const sessionMessage = this.toSessionManagerMessage(message)
      if (sessionMessage) sessionManager.appendMessage(sessionMessage)
    }
  }

  private toSessionManagerMessage(message: RuntimeRunInput['messages'][number]): SessionManagerMessage | null {
    const timestamp = message.createdAt
    if (message.role === 'user' || message.role === 'system') {
      return {
        role: 'user',
        content: [{ type: 'text', text: message.content }],
        timestamp,
      } as SessionManagerMessage
    }
    if (message.role === 'assistant') {
      const model = typeof message.metadata?.modelID === 'string' ? message.metadata.modelID : 'unknown'
      const finishReason = typeof message.metadata?.finishReason === 'string' ? message.metadata.finishReason : 'stop'
      return {
        role: 'assistant',
        content: [{ type: 'text', text: message.content }],
        api: 'messages',
        provider: 'unknown',
        model,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: finishReason,
        timestamp,
      } as SessionManagerMessage
    }
    return null
  }

  private mapEvent(event: PiSdkEvent): RuntimeEvent | null {
    const type = String(event.type ?? '')
    if (type === 'message_update') {
      const messageEvent = event.assistantMessageEvent
      const content = typeof messageEvent?.delta === 'string' ? messageEvent.delta : ''
      if (!content) return null
      if (messageEvent?.type === 'text_delta') return { type: 'message.delta', content }
      if (messageEvent?.type === 'thinking_delta') return { type: 'message.reasoning.delta', content }
      return null
    }
    if (type === 'message_end') {
      const usage = event.message?.usage
      return {
        type: 'message.completed',
        messageId: typeof event.messageId === 'string' ? event.messageId : typeof event.message?.id === 'string' ? event.message.id : crypto.randomUUID(),
        model: typeof event.message?.model === 'string' ? event.message.model : undefined,
        reason: typeof event.message?.stopReason === 'string' ? event.message.stopReason : undefined,
        usage: usage ? {
          input: Number(usage.input ?? 0),
          output: Number(usage.output ?? 0),
          cacheRead: Number(usage.cacheRead ?? 0),
          cacheWrite: Number(usage.cacheWrite ?? 0),
          cost: { total: Number(usage.cost?.total ?? 0) },
        } : undefined,
      }
    }
    if (type === 'tool_execution_start') {
      return {
        type: 'tool.requested',
        toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : typeof event.id === 'string' ? event.id : crypto.randomUUID(),
        toolName: typeof event.toolName === 'string' ? event.toolName : typeof event.name === 'string' ? event.name : 'unknown',
        input: event.input ?? event.args ?? {},
      }
    }
    if (type === 'tool_execution_update') {
      return {
        type: 'tool.updated',
        toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : typeof event.id === 'string' ? event.id : crypto.randomUUID(),
        output: event.output ?? event.delta ?? event.data ?? event.result ?? null,
      }
    }
    if (type === 'tool_execution_end') {
      const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : typeof event.id === 'string' ? event.id : crypto.randomUUID()
      const error = event.isError && typeof event.error === 'string' ? event.error : null
      if (error) return {
        type: 'tool.failed',
        toolCallId,
        error,
        toolName: typeof event.toolName === 'string' ? event.toolName : typeof event.name === 'string' ? event.name : undefined,
        input: event.input ?? event.args,
      }
      return {
        type: 'tool.completed',
        toolCallId,
        output: event.output ?? event.result ?? null,
        toolName: typeof event.toolName === 'string' ? event.toolName : typeof event.name === 'string' ? event.name : undefined,
        input: event.input ?? event.args,
      }
    }
    if (type === 'agent_end') return { type: 'run.completed' }
    if (type === 'error') return { type: 'run.failed', error: typeof event.error === 'string' ? event.error : 'Pi runtime failed' }
    return null
  }
}
