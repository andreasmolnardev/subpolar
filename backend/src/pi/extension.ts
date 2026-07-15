import { readFileSync } from 'fs'
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent'
import { getPiRunContext } from './run-context'

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

const INTERNAL_TOOL_NAMES = new Set(['skill-discover', 'skill-load', 'subpolar-tools', 'subpolar-mcp', 'subpolar-openapi'])
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

const subpolarToolsParameters = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'describe', 'call'],
      description: 'Whether to list available tools, describe one tool, or call one tool',
    },
    toolId: {
      type: 'string',
      description: 'Dot-based Subpolar tool id. Required for describe and call.',
    },
    input: {
      type: 'object',
      description: 'JSON object input for call actions',
      additionalProperties: true,
    },
  },
  required: ['action'],
  additionalProperties: false,
}

const subpolarMcpParameters = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['search', 'load', 'run'], description: 'Search MCP tools, load one exact schema, or run one exact tool.' },
    serverId: { type: 'string', description: 'MCP server id, required for load and run.' },
    toolId: { type: 'string', description: 'Stable MCP tool id, required for load and run.' },
    query: { type: 'string', description: 'Optional server/tool/description search query.' },
    input: { type: 'object', description: 'JSON object input, required for run.', additionalProperties: true },
  },
  required: ['action'],
  additionalProperties: false,
}

const subpolarOpenApiParameters = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['search', 'load', 'run'], description: 'Search OpenAPI tools, load one exact schema, or run one exact operation.' },
    serverId: { type: 'string', description: 'OpenAPI provider id, required for load and run.' },
    toolId: { type: 'string', description: 'Stable OpenAPI tool id, required for load and run.' },
    query: { type: 'string', description: 'Optional provider/tool/description search query.' },
    input: { type: 'object', description: 'JSON object input, required for run.', additionalProperties: true },
  },
  required: ['action'],
  additionalProperties: false,
}

function requiredEnv(name: string): string {
  const context = getPiRunContext()
  const contextValue = context && ({
    SUBPOLAR_BASE_URL: context.baseUrl,
    SUBPOLAR_INTERNAL_TOKEN: context.internalToken,
    SUBPOLAR_AGENT_ID: context.agentId,
    SUBPOLAR_SESSION_ID: context.sessionId,
    SUBPOLAR_RUN_ID: context.runId,
  } as Record<string, string>)[name]
  if (contextValue) return contextValue
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
    if (INTERNAL_TOOL_NAMES.has(request.toolName)) return undefined
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
  const context = getPiRunContext()
  if (context) return context.skills
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

async function callSubpolarBackend(path: string, body: Record<string, unknown>): Promise<ExtensionToolResult> {
  const baseUrl = requiredEnv('SUBPOLAR_BASE_URL').replace(/\/+$/, '')
  const token = requiredEnv('SUBPOLAR_INTERNAL_TOKEN')
  const response = await fetch(`${baseUrl}/api/subpolar-cli${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({ ok: false, error: { code: 'BAD_BACKEND_RESPONSE', message: 'Backend returned non-JSON response' } }))
  return textResult(JSON.stringify(result, null, 2), { routedToBackend: true, status: response.status })
}

async function callSubpolarTools(params: unknown): Promise<ExtensionToolResult> {
  const input = params && typeof params === 'object' ? params as { action?: unknown; toolId?: unknown; input?: unknown } : {}
  const agentId = requiredEnv('SUBPOLAR_AGENT_ID')
  if (input.action === 'list') return callSubpolarBackend('/tools/list', { agentId })
  if (typeof input.toolId !== 'string' || input.toolId.length === 0) return textResult('toolId is required for describe and call actions', { ok: false })
  if (input.action === 'describe') return callSubpolarBackend('/tools/describe', { agentId, toolId: input.toolId })
  if (input.action === 'call') return callSubpolarBackend('/tools/call', { agentId, toolId: input.toolId, input: input.input ?? {}, sessionId: requiredEnv('SUBPOLAR_SESSION_ID') })
  return textResult('action must be one of: list, describe, call', { ok: false })
}

async function callSubpolarMcp(params: unknown): Promise<ExtensionToolResult> {
  const input = params && typeof params === 'object' ? params as { action?: unknown; serverId?: unknown; toolId?: unknown; query?: unknown; input?: unknown } : {}
  const agentId = requiredEnv('SUBPOLAR_AGENT_ID')
  if (input.action === 'search') return callSubpolarBackend('/mcp/search', { agentId, sessionId: requiredEnv('SUBPOLAR_SESSION_ID'), query: input.query })
  if (typeof input.serverId !== 'string' || typeof input.toolId !== 'string') return textResult('serverId and toolId are required for load and run actions', { ok: false })
  if (input.action === 'load') return callSubpolarBackend('/mcp/load', { agentId, sessionId: requiredEnv('SUBPOLAR_SESSION_ID'), serverId: input.serverId, toolId: input.toolId })
  if (input.action === 'run') return callSubpolarBackend('/mcp/run', { agentId, sessionId: requiredEnv('SUBPOLAR_SESSION_ID'), serverId: input.serverId, toolId: input.toolId, input: input.input ?? {} })
  return textResult('action must be one of: search, load, run', { ok: false })
}

async function callSubpolarOpenApi(params: unknown): Promise<ExtensionToolResult> {
  const input = params && typeof params === 'object' ? params as { action?: unknown; serverId?: unknown; toolId?: unknown; query?: unknown; input?: unknown } : {}
  const agentId = requiredEnv('SUBPOLAR_AGENT_ID')
  if (input.action === 'search') return callSubpolarBackend('/openapi/search', { agentId, sessionId: requiredEnv('SUBPOLAR_SESSION_ID'), query: input.query })
  if (typeof input.serverId !== 'string' || typeof input.toolId !== 'string') return textResult('serverId and toolId are required for load and run actions', { ok: false })
  if (input.action === 'load') return callSubpolarBackend('/openapi/load', { agentId, sessionId: requiredEnv('SUBPOLAR_SESSION_ID'), serverId: input.serverId, toolId: input.toolId })
  if (input.action === 'run') return callSubpolarBackend('/openapi/run', { agentId, sessionId: requiredEnv('SUBPOLAR_SESSION_ID'), serverId: input.serverId, toolId: input.toolId, input: input.input ?? {} })
  return textResult('action must be one of: search, load, run', { ok: false })
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

function registerSubpolarTools(pi: ExtensionApi): void {
  if (!pi.registerTool) return

  pi.registerTool({
    name: 'subpolar-tools',
    label: 'Subpolar Tools',
    description: 'List, describe, and call Subpolar-managed backend tools directly.',
    promptSnippet: 'Use subpolar-tools for Subpolar-managed backend tools instead of shell commands.',
    promptGuidelines: ['Use action=list when unsure which tools are available.', 'Use action=describe before calling an unfamiliar tool.', 'Use action=call with exact dot-based tool ids and JSON object input.'],
    parameters: subpolarToolsParameters,
    async execute(_toolCallId, params) {
      return callSubpolarTools(params)
    },
  })
}

function registerMcpTool(pi: ExtensionApi): void {
  if (!pi.registerTool) return
  pi.registerTool({
    name: 'subpolar-mcp', label: 'Subpolar MCP',
    description: 'Search, inspect, and run permissioned Model Context Protocol tools managed by Subpolar.',
    promptSnippet: 'Use subpolar-mcp to access MCP servers. Search and load unfamiliar tools before running them.',
    promptGuidelines: ['Use search before load or run.', 'Use load before running an unfamiliar MCP tool.', 'Run only exact stable tool ids with JSON object input.'],
    parameters: subpolarMcpParameters,
    async execute(_toolCallId, params) { return callSubpolarMcp(params) },
  })
}

function registerOpenApiTool(pi: ExtensionApi): void {
  if (!pi.registerTool) return
  pi.registerTool({
    name: 'subpolar-openapi', label: 'Subpolar OpenAPI',
    description: 'Search, inspect, and run permissioned OpenAPI operations managed by Subpolar.',
    promptSnippet: 'Use subpolar-openapi to access configured API providers. Search and load unfamiliar operations before running them.',
    promptGuidelines: ['Use search before load or run.', 'Use load before running an unfamiliar OpenAPI operation.', 'Run only exact stable tool ids with JSON object input.'],
    parameters: subpolarOpenApiParameters,
    async execute(_toolCallId, params) { return callSubpolarOpenApi(params) },
  })
}

function registerBashTool(pi: ExtensionApi): void {
  if (!pi.registerTool) return

  pi.registerTool({
    name: 'bash',
    label: 'bash',
    description: 'Execute bash commands.',
    promptSnippet: 'Execute bash commands.',
    parameters: bashParameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const bash = createBashToolDefinition(ctx?.cwd ?? process.cwd())
      return bash.execute(toolCallId, params as { command: string; timeout?: number }, signal, onUpdate, ctx as never)
    },
  })
}

export default function subpolarPiExtension(pi: ExtensionApi) {
  const register = pi.hook ?? pi.on
  if (!register) return
  registerSkillTools(pi)
  registerSubpolarTools(pi)
  registerMcpTool(pi)
  registerOpenApiTool(pi)
  registerBashTool(pi)
  register.call(pi, 'project_trust', () => ({ trusted: 'no' }))
  register.call(pi, 'tool_call', (event) => authorizeToolCall(event as PiToolCall))
}
