import type PocketBase from 'pocketbase'
import type { AgentDefinition } from '@subpolar/shared/types'

function toAgent(record: Record<string, unknown>): AgentDefinition {
  return {
    id: String(record.id),
    name: String(record.name),
    description: String(record.description ?? ''),
    mode: record.mode === 'primary' ? 'primary' : 'subagent',
    prompt: String(record.prompt ?? ''),
    systemPrompt: String(record.systemPrompt ?? ''),
    permission: (record.permission && typeof record.permission === 'object' ? record.permission : {}) as Record<string, unknown>,
    skills: Array.isArray(record.skills) ? record.skills.map(String) : [],
    skillAccess: Array.isArray(record.skill_access) ? record.skill_access as AgentDefinition['skillAccess'] : [],
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

export async function createUserAgent(db: PocketBase, definition: Omit<AgentDefinition, 'id' | 'created_at' | 'updated_at'>): Promise<AgentDefinition> {
  const now = Date.now()
  const created = await db.collection('agents').create({
    ...definition,
    source: 'user',
    created_at: now,
    updated_at: now,
  })
  return toAgent(created as unknown as Record<string, unknown>)
}

export async function updateAgent(db: PocketBase, identifier: string, updates: Partial<Omit<AgentDefinition, 'id' | 'created_at' | 'updated_at'>>): Promise<AgentDefinition | null> {
  const existing = await db.collection('agents').getOne(identifier).catch(async () => {
    const escaped = identifier.replaceAll('"', '\\"')
    return await db.collection('agents').getFirstListItem(`name = "${escaped}"`).catch(() => null)
  })
  if (!existing) return null

  const updated = await db.collection('agents').update(String(existing.id), {
    ...updates,
    updated_at: Date.now(),
  })
  return toAgent(updated as unknown as Record<string, unknown>)
}

export async function deleteAgent(db: PocketBase, identifier: string): Promise<boolean> {
  const existing = await db.collection('agents').getOne(identifier).catch(async () => {
    const escaped = identifier.replaceAll('"', '\\"')
    return await db.collection('agents').getFirstListItem(`name = "${escaped}"`).catch(() => null)
  })
  if (!existing) return false
  await db.collection('agents').delete(String(existing.id))
  return true
}

export async function deleteSystemAgents(db: PocketBase): Promise<void> {
  const records = await db.collection('agents').getFullList({ filter: 'source = "system"' })
  for (const record of records) {
    await db.collection('agents').delete(String(record.id))
  }
}
