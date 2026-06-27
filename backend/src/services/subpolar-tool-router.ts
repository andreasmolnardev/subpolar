import type { AgentDefinition, ToolDefinition } from '@subpolar/shared/types'
import { createApproval, getEnabledTool, listEnabledTools, listPoliciesForAgent, writeToolAudit } from '../db/subpolar-tools'
import { getAgentByIdOrSlug } from '../db/subpolar-agents'
import type { Database } from '../db/schema'
import { getEnabledIntegrationForTool } from '../db/integrations'
import type { IntegrationType } from '@subpolar/shared/types'

type PolicyResult =
  | { decision: 'allow' }
  | { decision: 'deny'; code: string; message: string }
  | { decision: 'approval'; approvalId: string; message: string }

export type ToolPermissionOverride = 'ask' | 'none' | 'allow_all'

function validateInput(schema: Record<string, unknown>, input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Input must be a JSON object'
  const required = Array.isArray(schema.required) ? schema.required.map(String) : []
  const objectInput = input as Record<string, unknown>
  for (const key of required) {
    if (objectInput[key] === undefined) return `Missing required field: ${key}`
  }
  return null
}

async function checkPolicy(db: Database, agent: AgentDefinition, tool: ToolDefinition, input: unknown, sessionId?: string, permissionOverride?: ToolPermissionOverride): Promise<PolicyResult> {
  const agentId = agent.id

  const validationError = validateInput(tool.input_schema, input)
  if (validationError) return { decision: 'deny', code: 'VALIDATION_FAILED', message: validationError }

  if (permissionOverride === 'none') return { decision: 'deny', code: 'PERMISSION_DENIED', message: `Tool calls are disabled for this run: ${tool.tool_id}` }

  if (permissionOverride === 'ask') {
    const approvalId = await createApproval(db, { agent_id: agentId, session_id: sessionId, tool_id: tool.tool_id, input, reason: `${tool.tool_id} requires approval` })
    return { decision: 'approval', approvalId, message: `${tool.tool_id} requires approval` }
  }

  if (permissionOverride === 'allow_all') return { decision: 'allow' }

  const policies = await listPoliciesForAgent(db, agentId)
  const matching = policies.filter(policy => policy.tool_id === tool.tool_id || policy.tool_id === '*')

  if (matching.some(policy => policy.effect === 'deny')) return { decision: 'deny', code: 'PERMISSION_DENIED', message: `Agent is not allowed to use ${tool.tool_id}` }

  if (tool.requires_approval || matching.some(policy => policy.effect === 'approval')) {
    const approvalId = await createApproval(db, { agent_id: agentId, session_id: sessionId, tool_id: tool.tool_id, input, reason: `${tool.tool_id} requires approval` })
    return { decision: 'approval', approvalId, message: `${tool.tool_id} requires approval` }
  }

  if (matching.some(policy => policy.effect === 'allow')) return { decision: 'allow' }

  return { decision: 'deny', code: 'PERMISSION_DENIED', message: `Agent is not allowed to use ${tool.tool_id}` }
}

async function callIntegrationTool(db: Database, tool: ToolDefinition, input: unknown): Promise<unknown> {
  const integrationType = typeof tool.metadata.integrationType === 'string' ? tool.metadata.integrationType as IntegrationType : undefined
  if (!integrationType) {
    return { toolId: tool.tool_id, result: null }
  }

  const inputObject = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const integrationId = typeof inputObject.integrationId === 'string' ? inputObject.integrationId : undefined
  const integration = await getEnabledIntegrationForTool(db, integrationType, integrationId)
  if (!integration) {
    throw Object.assign(new Error(`No enabled ${integrationType} integration is configured`), { code: 'INTEGRATION_NOT_CONFIGURED' })
  }

  if (tool.target === 'caldav') {
    return { toolId: tool.tool_id, integrationId: integration.id, provider: 'caldav', operation: tool.operation, status: 'configured', input }
  }

  if (tool.target === 'imap_smtp') {
    return { toolId: tool.tool_id, integrationId: integration.id, provider: 'imap_smtp', operation: tool.operation, status: 'configured', input }
  }

  if (tool.adapter === 'mcp') {
    return { toolId: tool.tool_id, integrationId: integration.id, provider: 'mcp', server: tool.target, operation: tool.operation, status: 'configured', input }
  }

  return { toolId: tool.tool_id, integrationId: integration.id, operation: tool.operation, status: 'configured', input }
}

export async function listToolsForAgent(db: Database, agentId: string) {
  const agent = await getAgentByIdOrSlug(db, agentId)
  if (!agent || !agent.enabled) return []

  const tools = await listEnabledTools(db)
  const policies = await listPoliciesForAgent(db, agent.id)
  const allowedIds = new Set(policies.filter(policy => policy.effect === 'allow' || policy.effect === 'approval').map(policy => policy.tool_id))
  return tools
    .filter(tool => allowedIds.has(tool.tool_id) || allowedIds.has('*'))
    .map(tool => ({ id: tool.tool_id, description: tool.description, requiresApproval: tool.requires_approval || policies.some(policy => policy.tool_id === tool.tool_id && policy.effect === 'approval') }))
}

export async function describeToolForAgent(db: Database, agentId: string, toolId: string) {
  const tool = await getEnabledTool(db, toolId)
  if (!tool) return null
  const agent = await getAgentByIdOrSlug(db, agentId)
  if (!agent || !agent.enabled) return null
  const policies = await listPoliciesForAgent(db, agent.id)
  const matching = policies.filter(policy => policy.tool_id === tool.tool_id || policy.tool_id === '*')
  if (matching.some(policy => policy.effect === 'deny')) return null
  const allowed = matching.some(policy => policy.effect === 'allow' || policy.effect === 'approval')
  if (!allowed) return null
  return {
    id: tool.tool_id,
    description: tool.description,
    inputSchema: tool.input_schema,
    outputSchema: tool.output_schema,
    examples: tool.metadata.examples ?? [],
    risk: tool.risk,
    requiresApproval: tool.requires_approval || matching.some(policy => policy.effect === 'approval'),
  }
}

export async function callTool(db: Database, agentId: string, toolId: string, input: unknown, sessionId?: string, permissionOverride?: ToolPermissionOverride) {
  const tool = await getEnabledTool(db, toolId)
  if (!tool) {
    await writeToolAudit(db, { agent_id: agentId, session_id: sessionId, tool_id: toolId, input, status: 'error', error_code: 'UNKNOWN_TOOL' })
    return { ok: false as const, toolId, error: { code: 'UNKNOWN_TOOL', message: 'Tool does not exist or is disabled' } }
  }

  const agent = await getAgentByIdOrSlug(db, agentId)
  if (!agent || !agent.enabled) {
    await writeToolAudit(db, { agent_id: agentId, session_id: sessionId, tool_id: toolId, input, status: 'denied', error_code: 'UNKNOWN_AGENT' })
    return { ok: false as const, toolId, error: { code: 'UNKNOWN_AGENT', message: 'Agent is not enabled or does not exist' } }
  }

  const resolvedAgentId = agent.id
  const policy = await checkPolicy(db, agent, tool, input, sessionId, permissionOverride)
  if (policy.decision === 'deny') {
    await writeToolAudit(db, { agent_id: resolvedAgentId, session_id: sessionId, tool_id: toolId, input, status: policy.code === 'VALIDATION_FAILED' ? 'error' : 'denied', error_code: policy.code })
    return { ok: false as const, toolId, error: { code: policy.code, message: policy.message } }
  }

  if (policy.decision === 'approval') {
    await writeToolAudit(db, { agent_id: resolvedAgentId, session_id: sessionId, tool_id: toolId, input, status: 'approval_required', approval_id: policy.approvalId })
    return { ok: false as const, toolId, approvalRequired: true, approvalId: policy.approvalId, message: policy.message }
  }

  try {
    const result = await callIntegrationTool(db, tool, input)
    await writeToolAudit(db, { agent_id: resolvedAgentId, session_id: sessionId, tool_id: toolId, input, status: 'success', result_summary: `${tool.target} adapter accepted call` })
    return { ok: true as const, toolId, result }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'TOOL_EXECUTION_FAILED'
    const message = error instanceof Error ? error.message : 'Tool execution failed'
    await writeToolAudit(db, { agent_id: resolvedAgentId, session_id: sessionId, tool_id: toolId, input, status: 'error', error_code: code })
    return { ok: false as const, toolId, error: { code, message } }
  }
}
