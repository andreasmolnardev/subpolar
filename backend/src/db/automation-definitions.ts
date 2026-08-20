import { createHash, randomBytes } from 'crypto'
import type PocketBase from 'pocketbase'
import {
  AutomationDefinitionSchema,
  AutomationDefinitionRunSchema,
  type AutomationDefinition,
  type AutomationDefinitionRun,
  type CreateAutomationDefinitionRequest,
} from '@subpolar/shared/schemas'

type RecordData = Record<string, unknown> & { id: string }

function escaped(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

async function deleteWhere(pb: PocketBase, collection: string, filter: string): Promise<void> {
  const records = await pb.collection(collection).getFullList({ filter }) as unknown as RecordData[]
  await Promise.all(records.map((record) => pb.collection(collection).delete(record.id)))
}

async function readDefinition(pb: PocketBase, root: RecordData): Promise<AutomationDefinition> {
  const triggers = await pb.collection('automation_triggers').getFullList({ filter: `automation_id = "${escaped(root.id)}"`, sort: 'position' }) as unknown as RecordData[]
  const steps = await pb.collection('automation_steps').getFullList({ filter: `automation_id = "${escaped(root.id)}"`, sort: 'position' }) as unknown as RecordData[]
  const populatedTriggers = await Promise.all(triggers.map(async (trigger) => {
    const conditions = await pb.collection('automation_conditions').getFullList({ filter: `trigger_id = "${escaped(trigger.id)}"`, sort: 'position' }) as unknown as RecordData[]
    return {
      id: trigger.id, type: trigger.type, enabled: Boolean(trigger.enabled), position: Number(trigger.position), config: trigger.config,
      conditions: conditions.map((condition) => ({ type: condition.type, config: condition.config })), nextRunAt: trigger.next_run_at === undefined || trigger.next_run_at === null ? null : Number(trigger.next_run_at),
    }
  }))
  return AutomationDefinitionSchema.parse({
    id: root.id, projectId: root.project_id, name: root.name, description: root.description ?? '', icon: root.icon, enabled: Boolean(root.enabled), createdAt: Number(root.created_at), updatedAt: Number(root.updated_at),
    triggers: populatedTriggers,
    steps: steps.map((step) => ({ id: step.id, type: step.type, position: Number(step.position), config: step.config })),
  })
}

export async function listAutomationDefinitions(pb: PocketBase, projectId: string): Promise<AutomationDefinition[]> {
  const roots = await pb.collection('automations').getFullList({ filter: `project_id = "${escaped(projectId)}"`, sort: '-updated_at' }) as unknown as RecordData[]
  return Promise.all(roots.map((root) => readDefinition(pb, root)))
}

export async function getAutomationDefinition(pb: PocketBase, projectId: string, automationId: string): Promise<AutomationDefinition | null> {
  const root = await pb.collection('automations').getOne(automationId).catch(() => null) as RecordData | null
  if (!root || root.project_id !== projectId) return null
  return readDefinition(pb, root)
}

export async function getAutomationDefinitionById(pb: PocketBase, automationId: string): Promise<AutomationDefinition | null> {
  const root = await pb.collection('automations').getOne(automationId).catch(() => null) as RecordData | null
  return root ? readDefinition(pb, root) : null
}

export async function saveAutomationDefinition(pb: PocketBase, projectId: string, input: CreateAutomationDefinitionRequest, automationId?: string): Promise<{ definition: AutomationDefinition; webhookTokens: Record<string, string> }> {
  const now = Date.now()
  const existing = automationId ? await pb.collection('automations').getOne(automationId).catch(() => null) as RecordData | null : null
  if (automationId && (!existing || existing.project_id !== projectId)) throw new Error('Automation not found')
  if (existing && input.updatedAt !== undefined && Number(existing.updated_at) !== input.updatedAt) throw new Error('Automation was updated by another editor')
  const root = existing
    ? await pb.collection('automations').update(existing.id, { name: input.name, description: input.description, icon: input.icon, enabled: input.enabled, updated_at: now }) as unknown as RecordData
    : await pb.collection('automations').create({ project_id: projectId, name: input.name, description: input.description, icon: input.icon, enabled: input.enabled, created_at: now, updated_at: now }) as unknown as RecordData

  if (existing) {
    const oldTriggers = await pb.collection('automation_triggers').getFullList({ filter: `automation_id = "${escaped(root.id)}"` }) as unknown as RecordData[]
    await Promise.all(oldTriggers.map((trigger) => deleteWhere(pb, 'automation_conditions', `trigger_id = "${escaped(trigger.id)}"`)))
    await deleteWhere(pb, 'automation_triggers', `automation_id = "${escaped(root.id)}"`)
    await deleteWhere(pb, 'automation_steps', `automation_id = "${escaped(root.id)}"`)
  }
  const webhookTokens: Record<string, string> = {}
  for (const trigger of input.triggers) {
    const token = trigger.type === 'webhook' ? trigger.config.token ?? newToken() : undefined
    const record = await pb.collection('automation_triggers').create({ automation_id: root.id, type: trigger.type, enabled: trigger.enabled, position: trigger.position, config: trigger.type === 'webhook' ? { tokenCreated: true } : trigger.config, token_hash: token ? hashToken(token) : null, next_run_at: trigger.nextRunAt ?? null, created_at: now, updated_at: now }) as unknown as RecordData
    if (token) webhookTokens[record.id] = token
    for (const [position, condition] of trigger.conditions.entries()) {
      await pb.collection('automation_conditions').create({ trigger_id: record.id, position, type: condition.type, config: condition.config })
    }
  }
  for (const step of input.steps) {
    await pb.collection('automation_steps').create({ automation_id: root.id, position: step.position, type: step.type, config: step.config })
  }
  return { definition: await readDefinition(pb, root), webhookTokens }
}

export async function deleteAutomationDefinition(pb: PocketBase, projectId: string, automationId: string): Promise<boolean> {
  const definition = await getAutomationDefinition(pb, projectId, automationId)
  if (!definition) return false
  const triggers = await pb.collection('automation_triggers').getFullList({ filter: `automation_id = "${escaped(automationId)}"` }) as unknown as RecordData[]
  await Promise.all(triggers.map((trigger) => deleteWhere(pb, 'automation_conditions', `trigger_id = "${escaped(trigger.id)}"`)))
  await deleteWhere(pb, 'automation_triggers', `automation_id = "${escaped(automationId)}"`)
  await deleteWhere(pb, 'automation_steps', `automation_id = "${escaped(automationId)}"`)
  await pb.collection('automations').delete(automationId)
  return true
}

export async function createAutomationDefinitionRun(pb: PocketBase, definition: AutomationDefinition, triggerId: string | null, triggerType: 'manual' | 'schedule' | 'cron' | 'webhook', payload: unknown, status: 'running' | 'skipped' = 'running', errorText: string | null = null): Promise<AutomationDefinitionRun> {
  const now = Date.now()
  const record = await pb.collection('automation_definition_runs').create({ automation_id: definition.id, project_id: definition.projectId, trigger_id: triggerId, trigger_type: triggerType, trigger_payload: payload, status, started_at: now, finished_at: status === 'skipped' ? now : null, error_text: errorText }) as unknown as RecordData
  return AutomationDefinitionRunSchema.parse({ id: record.id, automationId: record.automation_id, projectId: record.project_id, triggerId: record.trigger_id ?? null, triggerType: record.trigger_type, status: record.status, startedAt: Number(record.started_at), finishedAt: record.finished_at === null || record.finished_at === undefined ? null : Number(record.finished_at), sessionId: record.session_id ?? null, responseText: record.response_text ?? null, errorText: record.error_text ?? null })
}

export async function listAutomationDefinitionRuns(pb: PocketBase, automationId: string): Promise<AutomationDefinitionRun[]> {
  const records = await pb.collection('automation_definition_runs').getFullList({ filter: `automation_id = "${escaped(automationId)}"`, sort: '-started_at' }) as unknown as RecordData[]
  return records.map((record) => AutomationDefinitionRunSchema.parse({ id: record.id, automationId: record.automation_id, projectId: record.project_id, triggerId: record.trigger_id ?? null, triggerType: record.trigger_type, status: record.status, startedAt: Number(record.started_at), finishedAt: record.finished_at === null || record.finished_at === undefined ? null : Number(record.finished_at), sessionId: record.session_id ?? null, responseText: record.response_text ?? null, errorText: record.error_text ?? null }))
}

export async function findWebhookTrigger(pb: PocketBase, token: string): Promise<RecordData | null> {
  return pb.collection('automation_triggers').getFirstListItem(`token_hash = "${hashToken(token)}"`).catch(() => null) as Promise<RecordData | null>
}
