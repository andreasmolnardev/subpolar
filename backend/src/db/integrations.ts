import type PocketBase from 'pocketbase'
import type { Integration, IntegrationType } from '@subpolar/shared/types'

function toIntegration(record: Record<string, unknown>): Integration {
  return {
    id: String(record.id),
    name: String(record.name),
    type: String(record.type) as IntegrationType,
    enabled: record.enabled !== false,
    config: (record.config && typeof record.config === 'object' ? record.config : {}) as Record<string, unknown>,
    secret_ref: record.secret_ref ? String(record.secret_ref) : undefined,
    metadata: (record.metadata && typeof record.metadata === 'object' ? record.metadata : {}) as Record<string, unknown>,
    created_at: Number(record.created_at ?? Date.now()),
    updated_at: Number(record.updated_at ?? Date.now()),
  }
}

export function normalizeIntegrationType(type: string): IntegrationType {
  return type === 'mail' ? 'imap_smtp' : type as IntegrationType
}

export function toSettingsIntegrationType(type: IntegrationType): 'mcp' | 'caldav' | 'mail' {
  return type === 'imap_smtp' ? 'mail' : type
}

export async function listIntegrations(pb: PocketBase): Promise<Integration[]> {
  const records = await pb.collection('integrations').getFullList({ sort: 'name' })
  return records.map(record => toIntegration(record as unknown as Record<string, unknown>))
}

export async function createIntegration(pb: PocketBase, data: Omit<Integration, 'id' | 'created_at' | 'updated_at'>): Promise<Integration> {
  const now = Date.now()
  const record = await pb.collection('integrations').create({
    ...data,
    created_at: now,
    updated_at: now,
  })
  return toIntegration(record as unknown as Record<string, unknown>)
}

export async function updateIntegration(pb: PocketBase, id: string, data: Partial<Omit<Integration, 'id' | 'created_at' | 'updated_at'>>): Promise<Integration> {
  const record = await pb.collection('integrations').update(id, {
    ...data,
    updated_at: Date.now(),
  })
  return toIntegration(record as unknown as Record<string, unknown>)
}

export async function deleteIntegration(pb: PocketBase, id: string): Promise<void> {
  await pb.collection('integrations').delete(id)
}

export async function listEnabledIntegrationsByType(pb: PocketBase, type: IntegrationType): Promise<Integration[]> {
  const records = await pb.collection('integrations').getFullList({ filter: `type = "${type}" && enabled = true`, sort: 'name' })
  return records.map(record => toIntegration(record as unknown as Record<string, unknown>))
}

export async function getEnabledIntegrationForTool(pb: PocketBase, type: IntegrationType, integrationId?: string): Promise<Integration | null> {
  if (integrationId) {
    const escaped = integrationId.replaceAll('"', '\\"')
    const record = await pb.collection('integrations').getFirstListItem(`id = "${escaped}" && type = "${type}" && enabled = true`).catch(() => null)
    return record ? toIntegration(record as unknown as Record<string, unknown>) : null
  }

  const integrations = await listEnabledIntegrationsByType(pb, type)
  return integrations[0] ?? null
}
