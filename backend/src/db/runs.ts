import type PocketBase from 'pocketbase'
import type { RuntimeEvent, RuntimeId, RuntimeMessage } from '../runtime/types'

export type StoredRun = {
  id: string
  runId: string
  sessionId: string
  agentId: string
  runtime: RuntimeId
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  error: string | null
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

function toMessage(record: Record<string, unknown>): RuntimeMessage {
  return {
    id: String(record.id),
    role: record.role === 'assistant' || record.role === 'system' || record.role === 'tool' ? record.role : 'user',
    content: String(record.content ?? ''),
    createdAt: Number(record.created_at ?? Date.now()),
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata as Record<string, unknown> : {},
  }
}

function toRun(record: Record<string, unknown>): StoredRun {
  return {
    id: String(record.id),
    runId: String(record.run_id),
    sessionId: String(record.session_id),
    agentId: String(record.agent_id),
    runtime: 'pi',
    status: record.status === 'running' || record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled' ? record.status : 'queued',
    error: typeof record.error === 'string' && record.error.length > 0 ? record.error : null,
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata as Record<string, unknown> : {},
    createdAt: Number(record.created_at ?? Date.now()),
    updatedAt: Number(record.updated_at ?? Date.now()),
  }
}

export async function createMessage(db: PocketBase, input: { sessionId: string; role: RuntimeMessage['role']; content: string; metadata?: Record<string, unknown>; createdAt?: number }): Promise<RuntimeMessage> {
  const record = await db.collection('messages').create({
    session_id: input.sessionId,
    role: input.role,
    content: input.content,
    metadata: input.metadata ?? {},
    created_at: input.createdAt ?? Date.now(),
  })
  return toMessage(record as unknown as Record<string, unknown>)
}

export async function listMessages(db: PocketBase, sessionId: string): Promise<RuntimeMessage[]> {
  const escaped = sessionId.replaceAll('"', '\\"')
  const records = await db.collection('messages').getFullList({ filter: `session_id = "${escaped}"`, sort: 'created_at' })
  return records.map(record => toMessage(record as unknown as Record<string, unknown>))
}

export async function createRun(db: PocketBase, input: { sessionId: string; agentId: string; runtime: RuntimeId; metadata?: Record<string, unknown> }): Promise<StoredRun> {
  const now = Date.now()
  const runId = crypto.randomUUID()
  const record = await db.collection('runs').create({
    run_id: runId,
    session_id: input.sessionId,
    agent_id: input.agentId,
    runtime: input.runtime,
    status: 'queued',
    error: '',
    metadata: input.metadata ?? {},
    created_at: now,
    updated_at: now,
  })
  return toRun(record as unknown as Record<string, unknown>)
}

export async function updateRunStatus(db: PocketBase, runId: string, status: StoredRun['status'], error?: string): Promise<void> {
  const escaped = runId.replaceAll('"', '\\"')
  const record = await db.collection('runs').getFirstListItem(`run_id = "${escaped}"`)
  await db.collection('runs').update(record.id, { status, error: error ?? '', updated_at: Date.now() })
}

export async function getRun(db: PocketBase, runId: string): Promise<StoredRun | null> {
  const escaped = runId.replaceAll('"', '\\"')
  const record = await db.collection('runs').getFirstListItem(`run_id = "${escaped}"`).catch(() => null)
  return record ? toRun(record as unknown as Record<string, unknown>) : null
}

export async function getActiveRunForSession(db: PocketBase, sessionId: string): Promise<StoredRun | null> {
  const escaped = sessionId.replaceAll('"', '\\"')
  const record = await db.collection('runs').getFirstListItem(`session_id = "${escaped}" && (status = "queued" || status = "running")`, { sort: '-updated_at' }).catch(() => null)
  return record ? toRun(record as unknown as Record<string, unknown>) : null
}

export async function writeRuntimeEvent(db: PocketBase, input: { runId: string; sessionId: string; event: RuntimeEvent }): Promise<void> {
  await db.collection('runtime_events').create({
    run_id: input.runId,
    session_id: input.sessionId,
    type: input.event.type,
    payload: input.event,
    created_at: Date.now(),
  })
}

export async function listRuntimeEvents(db: PocketBase, runId: string): Promise<Array<{ id: string; type: string; payload: RuntimeEvent; createdAt: number }>> {
  const escaped = runId.replaceAll('"', '\\"')
  const records = await db.collection('runtime_events').getFullList({ filter: `run_id = "${escaped}"`, sort: 'created_at' })
  return records.map(record => {
    const row = record as unknown as Record<string, unknown>
    return {
      id: String(row.id),
      type: String(row.type),
      payload: row.payload as RuntimeEvent,
      createdAt: Number(row.created_at ?? Date.now()),
    }
  })
}

export async function getSessionStatuses(db: PocketBase): Promise<Record<string, { type: 'idle' } | { type: 'busy' }>> {
  const records = await db.collection('runs').getFullList({ sort: '-updated_at' }).catch(() => [])
  const statuses: Record<string, { type: 'idle' } | { type: 'busy' }> = {}
  for (const record of records) {
    const run = toRun(record as unknown as Record<string, unknown>)
    if (statuses[run.sessionId]) continue
    statuses[run.sessionId] = run.status === 'queued' || run.status === 'running' ? { type: 'busy' } : { type: 'idle' }
  }
  return statuses
}
