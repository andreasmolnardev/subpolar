import type PocketBase from 'pocketbase'
import type { AgentToolPolicy, ToolAuditRecord, ToolDefinition } from '@subpolar/shared/types'
import { getAgentBySlug } from './subpolar-agents'

export type ToolSeed = Omit<ToolDefinition, 'id' | 'created_at' | 'updated_at'>
export type PolicySeed = Omit<AgentToolPolicy, 'id' | 'created_at' | 'updated_at'>
export type ToolApprovalRecord = {
  id: string
  agent_id: string
  session_id?: string
  tool_id: string
  input: unknown
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: number
  resolved_at?: number
}

function toTool(record: Record<string, unknown>): ToolDefinition {
  return {
    id: record.id ? String(record.id) : undefined,
    tool_id: String(record.tool_id),
    namespace: String(record.namespace),
    description: String(record.description ?? ''),
    adapter: ['internal', 'mcp', 'openapi', 'http', 'custom'].includes(String(record.adapter)) ? String(record.adapter) as ToolDefinition['adapter'] : 'internal',
    target: String(record.target ?? ''),
    operation: String(record.operation ?? ''),
    input_schema: (record.input_schema && typeof record.input_schema === 'object' ? record.input_schema : {}) as Record<string, unknown>,
    output_schema: (record.output_schema && typeof record.output_schema === 'object' ? record.output_schema : {}) as Record<string, unknown>,
    risk: ['read', 'write', 'delete', 'external'].includes(String(record.risk)) ? String(record.risk) as ToolDefinition['risk'] : 'read',
    requires_approval: record.requires_approval === true,
    enabled: record.enabled !== false,
    metadata: (record.metadata && typeof record.metadata === 'object' ? record.metadata : {}) as Record<string, unknown>,
    created_at: Number(record.created_at ?? Date.now()),
    updated_at: Number(record.updated_at ?? Date.now()),
  }
}

function toPolicy(record: Record<string, unknown>): AgentToolPolicy {
  return {
    id: record.id ? String(record.id) : undefined,
    agent_id: String(record.agent_id),
    tool_id: String(record.tool_id),
    effect: ['allow', 'deny', 'approval'].includes(String(record.effect)) ? String(record.effect) as AgentToolPolicy['effect'] : 'deny',
    constraints: (record.constraints && typeof record.constraints === 'object' ? record.constraints : {}) as Record<string, unknown>,
    created_at: Number(record.created_at ?? Date.now()),
    updated_at: Number(record.updated_at ?? Date.now()),
  }
}

function toApproval(record: Record<string, unknown>): ToolApprovalRecord {
  const status = String(record.status)
  return {
    id: String(record.id),
    agent_id: String(record.agent_id),
    session_id: typeof record.session_id === 'string' ? record.session_id : undefined,
    tool_id: String(record.tool_id),
    input: record.input,
    reason: String(record.reason ?? ''),
    status: status === 'approved' || status === 'rejected' ? status : 'pending',
    created_at: Number(record.created_at ?? Date.now()),
    resolved_at: record.resolved_at === undefined ? undefined : Number(record.resolved_at),
  }
}

export async function listEnabledTools(db: PocketBase): Promise<ToolDefinition[]> {
  const records = await db.collection('tool_registry').getFullList({ filter: 'enabled = true', sort: 'namespace,tool_id' })
  return records.map(record => toTool(record as unknown as Record<string, unknown>))
}

export async function getEnabledTool(db: PocketBase, toolId: string): Promise<ToolDefinition | null> {
  const escaped = toolId.replaceAll('"', '\\"')
  const record = await db.collection('tool_registry').getFirstListItem(`tool_id = "${escaped}" && enabled = true`).catch(() => null)
  return record ? toTool(record as unknown as Record<string, unknown>) : null
}

export async function listPoliciesForAgent(db: PocketBase, agentId: string): Promise<AgentToolPolicy[]> {
  const escaped = agentId.replaceAll('"', '\\"')
  const records = await db.collection('agent_tool_policies').getFullList({ filter: `agent_id = "${escaped}"` })
  return records.map(record => toPolicy(record as unknown as Record<string, unknown>))
}

export async function replacePoliciesForAgent(db: PocketBase, agentId: string, policies: Array<Omit<PolicySeed, 'agent_id'>>): Promise<AgentToolPolicy[]> {
  const existing = await listPoliciesForAgent(db, agentId)
  for (const policy of existing) {
    if (policy.id) await db.collection('agent_tool_policies').delete(policy.id)
  }

  const next: AgentToolPolicy[] = []
  for (const policy of policies) {
    next.push(await upsertPolicy(db, { ...policy, agent_id: agentId }))
  }
  return next
}

export async function upsertTool(db: PocketBase, definition: ToolSeed): Promise<ToolDefinition> {
  const now = Date.now()
  const escaped = definition.tool_id.replaceAll('"', '\\"')
  const existing = await db.collection('tool_registry').getFirstListItem(`tool_id = "${escaped}"`).catch(() => null)
  const data = { ...definition, updated_at: now }
  if (existing) {
    const updated = await db.collection('tool_registry').update(String((existing as unknown as { id: string }).id), data)
    return toTool(updated as unknown as Record<string, unknown>)
  }
  const created = await db.collection('tool_registry').create({ ...data, created_at: now })
  return toTool(created as unknown as Record<string, unknown>)
}

export async function upsertPolicy(db: PocketBase, definition: PolicySeed): Promise<AgentToolPolicy> {
  const now = Date.now()
  const agentId = definition.agent_id.replaceAll('"', '\\"')
  const toolId = definition.tool_id.replaceAll('"', '\\"')
  const existing = await db.collection('agent_tool_policies').getFirstListItem(`agent_id = "${agentId}" && tool_id = "${toolId}"`).catch(() => null)
  const data = { ...definition, updated_at: now }
  if (existing) {
    const updated = await db.collection('agent_tool_policies').update(String((existing as unknown as { id: string }).id), data)
    return toPolicy(updated as unknown as Record<string, unknown>)
  }
  const created = await db.collection('agent_tool_policies').create({ ...data, created_at: now })
  return toPolicy(created as unknown as Record<string, unknown>)
}

export async function createApproval(db: PocketBase, data: { agent_id: string; session_id?: string; tool_id: string; input: unknown; reason: string }): Promise<string> {
  const created = await db.collection('tool_approvals').create({ ...data, status: 'pending', created_at: Date.now() })
  return String((created as unknown as { id: string }).id)
}

export async function getApproval(db: PocketBase, approvalId: string): Promise<ToolApprovalRecord | null> {
  const record = await db.collection('tool_approvals').getOne(approvalId).catch(() => null)
  return record ? toApproval(record as unknown as Record<string, unknown>) : null
}

export async function listPendingApprovals(db: PocketBase, sessionId?: string): Promise<ToolApprovalRecord[]> {
  const filters = ['status = "pending"']
  if (sessionId) filters.push(`session_id = "${sessionId.replaceAll('"', '\\"')}"`)
  const records = await db.collection('tool_approvals').getFullList({ filter: filters.join(' && '), sort: '-created_at' })
  return records.map(record => toApproval(record as unknown as Record<string, unknown>))
}

export async function respondToApproval(db: PocketBase, approvalId: string, approved: boolean): Promise<ToolApprovalRecord> {
  const updated = await db.collection('tool_approvals').update(approvalId, { status: approved ? 'approved' : 'rejected', resolved_at: Date.now() })
  return toApproval(updated as unknown as Record<string, unknown>)
}

export async function writeToolAudit(db: PocketBase, data: Omit<ToolAuditRecord, 'id' | 'created_at'>): Promise<void> {
  await db.collection('tool_call_audit').create({ ...data, created_at: Date.now() })
}

export async function seedTools(db: PocketBase, tools: ToolSeed[], policies: PolicySeed[]): Promise<void> {
  const staticMcpTools = await db.collection('tool_registry').getFullList({ filter: 'tool_id ~ "mcp.github."' }).catch(() => [])
  for (const tool of staticMcpTools) await db.collection('tool_registry').update(String(tool.id), { enabled: false, updated_at: Date.now() })
  for (const tool of tools) await upsertTool(db, tool)
  for (const policy of policies) {
    const agent = await getAgentBySlug(db, policy.agent_id)
    await upsertPolicy(db, { ...policy, agent_id: agent?.id ?? policy.agent_id })
  }
}
