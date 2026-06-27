import { readFileSync } from 'fs'
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent'

type PiToolAuthorizationRequest = {
  agentId: string
  sessionId: string
  runId: string
  toolCallId: string
  toolName: string
  input: unknown
  cwd?: string
}

type PiToolAuthorizationResponse =
  | { ok: true; decision: 'allow' }
  | { ok: false; decision: 'deny' | 'approval'; message?: string }

type PiToolCall = {
  id?: unknown
  toolCallId?: unknown
  name?: unknown
  toolName?: unknown
  input?: unknown
  args?: unknown
  cwd?: unknown
}

type SkillInfo = {
  name: string
  description: string
  filePath: string
  baseDir: string
}

type SkillDiscoverParams = {
  query?: string
  limit?: number
}

type SkillLoadParams = {
  name: string
}

type ExtensionToolResult = {
  content: unknown[]
  details: unknown
}

type ExtensionToolContext = {
  cwd: string
}

type ExtensionApi = {
  hook?: (name: string, handler: (event: unknown) => unknown) => void
  on?: (name: string, handler: (event: unknown) => unknown) => void
  registerTool?: (tool: {
    name: string
    label: string
    description: string
    promptSnippet?: string
    promptGuidelines?: string[]
    parameters: unknown
    execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (result: ExtensionToolResult) => void, ctx?: ExtensionToolContext) => Promise<ExtensionToolResult>
  }) => void
}

const SKILL_TOOL_NAMES = new Set(['skill-discover', 'skill-load'])
const skillDiscoverParameters = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Optional case-insensitive filter matched against skill names and descriptions',
    },
    limit: {
      type: 'number',
      description: 'Optional maximum number of skills to return',
    },
  },
  additionalProperties: false,
}

const skillLoadParameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Exact skill name from skill-discover',
    },
  },
  required: ['name'],
  additionalProperties: false,
}

const bashParameters = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The command to execute' },
    timeout: { type: 'number', description: 'Optional timeout in seconds' },
  },
  required: ['command'],
  additionalProperties: false,
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function toolCallValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export function createAuthorizationRequest(toolCall: PiToolCall): PiToolAuthorizationRequest {
  return {
    agentId: requiredEnv('SUBPOLAR_AGENT_ID'),
    sessionId: requiredEnv('SUBPOLAR_SESSION_ID'),
    runId: requiredEnv('SUBPOLAR_RUN_ID'),
    toolCallId: toolCallValue(toolCall.toolCallId ?? toolCall.id, crypto.randomUUID()),
    toolName: toolCallValue(toolCall.toolName ?? toolCall.name, 'unknown'),
    input: toolCall.input ?? toolCall.args ?? {},
    cwd: typeof toolCall.cwd === 'string' ? toolCall.cwd : undefined,
  }
}

export async function authorizeToolCall(toolCall: PiToolCall): Promise<void | { block: true; reason: string }> {
  let request: PiToolAuthorizationRequest
  try {
    request = createAuthorizationRequest(toolCall)
  } catch (error) {
    return { block: true, reason: error instanceof Error ? error.message : 'Pi tool authorization is not configured' }
  }

  try {
    const baseUrl = requiredEnv('SUBPOLAR_BASE_URL').replace(/\/+$/, '')
    const token = requiredEnv('SUBPOLAR_INTERNAL_TOKEN')
    if (SKILL_TOOL_NAMES.has(request.toolName)) return undefined
    const response = await fetch(`${baseUrl}/api/pi/tools/authorize`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    })
    if (!response.ok) return { block: true, reason: `Subpolar authorization failed with HTTP ${response.status}` }

    const result = await response.json() as PiToolAuthorizationResponse
    if (result.ok && result.decision === 'allow') return undefined
    return { block: true, reason: result.message ?? `Subpolar blocked ${request.toolName}` }
  } catch (error) {
    return { block: true, reason: error instanceof Error ? error.message : 'Subpolar authorization failed' }
  }
}

function getSkills(): SkillInfo[] {
  const raw = process.env.SUBPOLAR_PI_SKILLS
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((skill): skill is SkillInfo =>
      skill &&
      typeof skill === 'object' &&
      typeof skill.name === 'string' &&
      typeof skill.description === 'string' &&
      typeof skill.filePath === 'string' &&
      typeof skill.baseDir === 'string'
    )
  } catch {
    return []
  }
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  return end === -1 ? content : content.slice(end + 4)
}

function textResult(text: string, details: Record<string, unknown>): ExtensionToolResult {
  return {
    content: [{ type: 'text', text }],
    details,
  }
}

function shellWords(command: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaping = false

  for (const char of command.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\' && quote !== 'single') {
      escaping = true
      continue
    }
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      continue
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
      continue
    }
    if (/\s/.test(char) && !quote) {
      if (current) words.push(current)
      current = ''
      continue
    }
    current += char
  }

  if (current) words.push(current)
  return words
}

export function parseSubpolarCliCommand(command: string): { path: string; body: Record<string, unknown> } | null {
  const words = shellWords(command)
  if (words[0] !== 'subpolar-cli') return null

  const agentIndex = words.findIndex(word => word === '--agentId' || word.startsWith('--agentId='))
  const agentArg = agentIndex === -1 ? undefined : words[agentIndex]
  const agentId = agentArg === undefined ? process.env.SUBPOLAR_AGENT_ID : agentArg.includes('=') ? agentArg.slice(agentArg.indexOf('=') + 1) : words[agentIndex + 1]
  const agentValueIndex = agentIndex !== -1 && agentArg && !agentArg.includes('=') ? agentIndex + 1 : -1
  const args = words.slice(1).filter((_, index) => index !== agentIndex - 1 && index !== agentValueIndex - 1)

  if (args[0] === 'tools' && args[1] === 'list') return { path: '/tools/list', body: { agentId } }
  const toolId = args[0]
  if (!toolId) return { path: '/tools/list', body: { agentId } }
  if (args[1] === '--help') return { path: '/tools/describe', body: { agentId, toolId } }

  let input: unknown = {}
  if (args[1]) input = JSON.parse(args[1])
  return { path: '/tools/call', body: { agentId, toolId, input, sessionId: process.env.SUBPOLAR_SESSION_ID } }
}

async function callSubpolarCli(command: string): Promise<ExtensionToolResult | null> {
  const parsed = parseSubpolarCliCommand(command)
  if (!parsed) return null

  const baseUrl = requiredEnv('SUBPOLAR_BASE_URL').replace(/\/+$/, '')
  const token = requiredEnv('SUBPOLAR_INTERNAL_TOKEN')
  const response = await fetch(`${baseUrl}/api/subpolar-cli${parsed.path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(parsed.body),
  })
  const result = await response.json().catch(() => ({ ok: false, error: { code: 'BAD_BACKEND_RESPONSE', message: 'Backend returned non-JSON response' } }))
  return textResult(JSON.stringify(result, null, 2), { routedToBackend: true, status: response.status })
}

function discoverSkills(params: SkillDiscoverParams): ExtensionToolResult {
  const query = params.query?.trim().toLowerCase()
  const limit = Number.isFinite(params.limit) && params.limit && params.limit > 0 ? Math.floor(params.limit) : undefined
  const skills = getSkills()
    .filter(skill => !query || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query))
    .slice(0, limit)
    .map(skill => ({ name: skill.name, description: skill.description }))

  return textResult(JSON.stringify({ skills }, null, 2), { count: skills.length, query })
}

function loadSkill(params: SkillLoadParams): ExtensionToolResult {
  const skill = getSkills().find(item => item.name === params.name)
  if (!skill) {
    return textResult(`Skill not found: ${params.name}`, { found: false, name: params.name })
  }

  const body = stripFrontmatter(readFileSync(skill.filePath, 'utf-8')).trim()
  return textResult(
    `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`,
    { found: true, name: skill.name, location: skill.filePath, baseDir: skill.baseDir },
  )
}

function registerSkillTools(pi: ExtensionApi): void {
  if (!pi.registerTool) return

  pi.registerTool({
    name: 'skill-discover',
    label: 'Discover Skills',
    description: 'List available skill names and brief descriptions. Optionally filter skills by a query.',
    promptSnippet: 'Discover available skills by name and description.',
    promptGuidelines: ['Use skill-discover before loading a skill when you are unsure which skill applies.', 'Use skill-load with an exact skill name to load full skill instructions.'],
    parameters: skillDiscoverParameters,
    async execute(_toolCallId, params) {
      return discoverSkills(params as SkillDiscoverParams)
    },
  })

  pi.registerTool({
    name: 'skill-load',
    label: 'Load Skill',
    description: 'Load full instructions for a named available skill.',
    promptSnippet: 'Load full instructions for a named available skill.',
    promptGuidelines: ['Call skill-load before applying a skill, then follow the loaded instructions.'],
    parameters: skillLoadParameters,
    async execute(_toolCallId, params) {
      return loadSkill(params as SkillLoadParams)
    },
  })
}

function registerBashTool(pi: ExtensionApi): void {
  if (!pi.registerTool) return

  pi.registerTool({
    name: 'bash',
    label: 'bash',
    description: 'Execute bash commands. subpolar-cli commands are routed directly to the Subpolar backend.',
    promptSnippet: 'Execute bash commands. Use subpolar-cli for Subpolar-managed backend tools.',
    parameters: bashParameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const input = params && typeof params === 'object' ? params as { command?: unknown } : {}
      if (typeof input.command === 'string') {
        const routed = await callSubpolarCli(input.command)
        if (routed) return routed
      }
      const bash = createBashToolDefinition(ctx?.cwd ?? process.cwd())
      return bash.execute(toolCallId, params as { command: string; timeout?: number }, signal, onUpdate, ctx as never)
    },
  })
}

export default function subpolarPiExtension(pi: ExtensionApi) {
  const register = pi.hook ?? pi.on
  if (!register) return
  registerSkillTools(pi)
  registerBashTool(pi)
  register.call(pi, 'project_trust', () => ({ trusted: 'no' }))
  register.call(pi, 'tool_call', (event) => authorizeToolCall(event as PiToolCall))
}
