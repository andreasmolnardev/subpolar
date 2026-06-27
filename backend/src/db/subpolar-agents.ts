import type PocketBase from 'pocketbase'
import type { AgentDefinition } from '@subpolar/shared/types'

export type SystemAgentSeed = Omit<AgentDefinition, 'id' | 'source' | 'created_at' | 'updated_at'> & { name: string }

function toAgent(record: Record<string, unknown>): AgentDefinition {
  return {
    id: String(record.id),
    name: String(record.name),
    description: String(record.description ?? ''),
    mode: record.mode === 'primary' ? 'primary' : 'subagent',
    prompt: String(record.prompt ?? ''),
    permission: (record.permission && typeof record.permission === 'object' ? record.permission : {}) as Record<string, unknown>,
    skills: Array.isArray(record.skills) ? record.skills.map(String) : [],
    enabled: record.enabled !== false,
    source: record.source === 'user' ? 'user' : 'system',
    sort_order: Number(record.sort_order ?? 0),
    created_at: Number(record.created_at ?? Date.now()),
    updated_at: Number(record.updated_at ?? Date.now()),
  }
}

export async function listAgents(db: PocketBase): Promise<AgentDefinition[]> {
  const records = await db.collection('agents').getFullList({ sort: 'sort_order,name' })
  return records.map(record => toAgent(record as unknown as Record<string, unknown>))
}

export async function listEnabledAgents(db: PocketBase): Promise<AgentDefinition[]> {
  const records = await db.collection('agents').getFullList({ filter: 'enabled = true', sort: 'sort_order,name' })
  return records.map(record => toAgent(record as unknown as Record<string, unknown>))
}

export async function getAgentBySlug(db: PocketBase, slug: string): Promise<AgentDefinition | null> {
  const escaped = slug.replaceAll('"', '\\"')
  const record = await db.collection('agents').getFirstListItem(`name = "${escaped}"`).catch(() => null)
  return record ? toAgent(record as unknown as Record<string, unknown>) : null
}

export async function getAgentById(db: PocketBase, id: string): Promise<AgentDefinition | null> {
  const record = await db.collection('agents').getOne(id).catch(() => null)
  return record ? toAgent(record as unknown as Record<string, unknown>) : null
}

export async function getAgentByIdOrSlug(db: PocketBase, identifier: string): Promise<AgentDefinition | null> {
  return await getAgentById(db, identifier) ?? await getAgentBySlug(db, identifier)
}

export async function upsertSystemAgent(db: PocketBase, definition: SystemAgentSeed): Promise<AgentDefinition> {
  const now = Date.now()
  const escaped = definition.name.replaceAll('"', '\\"')
  const existing = await db.collection('agents').getFirstListItem(`name = "${escaped}"`).catch(() => null)
  const data = {
    ...definition,
    source: 'system',
    updated_at: now,
  }

  if (existing) {
    const row = existing as unknown as Record<string, unknown>
    if (row.source === 'user') return toAgent(row)
    const updated = await db.collection('agents').update(String(row.id), data)
    return toAgent(updated as unknown as Record<string, unknown>)
  }

  const created = await db.collection('agents').create({
    ...data,
    created_at: now,
  })
  return toAgent(created as unknown as Record<string, unknown>)
}

export async function seedSystemAgents(db: PocketBase, definitions: SystemAgentSeed[]): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = []
  for (const definition of definitions) {
    agents.push(await upsertSystemAgent(db, definition))
  }
  return agents
}
