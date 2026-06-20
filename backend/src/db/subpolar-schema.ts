import type PocketBase from 'pocketbase'

type Field = Record<string, unknown>

const text = (name: string, required = true): Field => ({ name, type: 'text', required })
const bool = (name: string): Field => ({ name, type: 'bool' })
const number = (name: string, required = true): Field => ({ name, type: 'number', required })
const json = (name: string): Field => ({ name, type: 'json' })
const select = (name: string, values: string[]): Field => ({ name, type: 'select', required: true, values, maxSelect: 1 })

async function ensureCollection(pb: PocketBase, name: string, fields: Field[], indexes: string[] = []): Promise<void> {
  const collections = pb.collections as unknown as {
    getOne: (name: string) => Promise<unknown>
    create: (data: Record<string, unknown>) => Promise<unknown>
  }
  const existing = await collections.getOne(name).catch(() => null)
  if (existing) return
  await collections.create({ name, type: 'base', fields, indexes })
}

export async function ensureSubpolarCollections(pb: PocketBase): Promise<void> {
  await ensureCollection(pb, 'integrations', [
    text('name'),
    select('type', ['mcp', 'caldav', 'imap_smtp']),
    bool('enabled'),
    json('config'),
    text('secret_ref', false),
    json('metadata'),
    number('created_at'),
    number('updated_at'),
  ], ['CREATE INDEX idx_integrations_type_enabled ON integrations (type, enabled)'])

  await ensureCollection(pb, 'agents', [
    text('name'),
    text('description'),
    select('mode', ['primary', 'subagent']),
    text('prompt'),
    json('permission'),
    json('skills'),
    bool('enabled'),
    select('source', ['system', 'user']),
    number('sort_order'),
    number('created_at'),
    number('updated_at'),
  ], ['CREATE UNIQUE INDEX idx_agents_name ON agents (name)', 'CREATE INDEX idx_agents_enabled ON agents (enabled)'])

  await ensureCollection(pb, 'tool_registry', [
    text('tool_id'),
    text('namespace'),
    text('description'),
    select('adapter', ['internal', 'mcp', 'openapi', 'http', 'custom']),
    text('target'),
    text('operation'),
    json('input_schema'),
    json('output_schema'),
    select('risk', ['read', 'write', 'delete', 'external']),
    bool('requires_approval'),
    bool('enabled'),
    json('metadata'),
    number('created_at'),
    number('updated_at'),
  ], ['CREATE UNIQUE INDEX idx_tool_registry_tool_id ON tool_registry (tool_id)', 'CREATE INDEX idx_tool_registry_enabled ON tool_registry (enabled)'])

  await ensureCollection(pb, 'agent_tool_policies', [
    text('agent_id'),
    text('tool_id'),
    select('effect', ['allow', 'deny', 'approval']),
    json('constraints'),
    number('created_at'),
    number('updated_at'),
  ], ['CREATE UNIQUE INDEX idx_agent_tool_policies_agent_tool ON agent_tool_policies (agent_id, tool_id)'])

  await ensureCollection(pb, 'tool_approvals', [
    text('agent_id'),
    text('session_id', false),
    text('tool_id'),
    json('input'),
    select('status', ['pending', 'approved', 'rejected', 'expired']),
    text('reason', false),
    number('created_at'),
    number('resolved_at', false),
  ], ['CREATE INDEX idx_tool_approvals_status_created ON tool_approvals (status, created_at)'])

  await ensureCollection(pb, 'tool_call_audit', [
    text('agent_id'),
    text('session_id', false),
    text('tool_id'),
    json('input'),
    select('status', ['success', 'error', 'approval_required', 'denied']),
    text('result_summary', false),
    text('error_code', false),
    text('approval_id', false),
    number('created_at'),
  ], ['CREATE INDEX idx_tool_call_audit_created ON tool_call_audit (created_at)', 'CREATE INDEX idx_tool_call_audit_agent_created ON tool_call_audit (agent_id, created_at)'])
}
