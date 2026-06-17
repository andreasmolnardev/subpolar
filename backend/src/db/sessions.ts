import type PocketBase from 'pocketbase'

export interface SessionRecord {
  id: string
  session_id: string
  project_id?: string | null
  directory?: string | null
  title?: string | null
  created_at: number
  updated_at: number
}

export interface StoredSession {
  id: string
  projectId: number | null
  directory: string | null
  title: string | null
  createdAt: number
  updatedAt: number
}

function rowToStoredSession(row: SessionRecord): StoredSession {
  return {
    id: row.session_id,
    projectId: row.project_id ? Number(row.project_id) : null,
    directory: row.directory ?? null,
    title: row.title ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function getProjectIdForDirectory(pb: PocketBase, directory?: string | null): Promise<string | null> {
  if (!directory) return null

  const escaped = directory.replaceAll('"', '\\"')
  const record = await pb.collection('projects').getFirstListItem(`full_path = "${escaped}" || directory = "${escaped}"`).catch(() => null)
  return record?.id ?? null
}

export async function upsertSessionRecord(
  pb: PocketBase,
  input: { sessionId: string; directory?: string | null; title?: string | null; projectId?: string | null },
): Promise<void> {
  try {
    const now = Date.now()
    const projectId = input.projectId !== undefined ? input.projectId : await getProjectIdForDirectory(pb, input.directory)
    const data = {
      session_id: input.sessionId,
      project_id: projectId,
      directory: input.directory ?? null,
      title: input.title ?? null,
      updated_at: now,
    }

    const escapedSessionId = input.sessionId.replaceAll('"', '\\"')
    const existing = await pb.collection('sessions').getFirstListItem(`session_id = "${escapedSessionId}"`).catch(() => null)
    if (existing) {
      await pb.collection('sessions').update(existing.id, data)
      return
    }

    await pb.collection('sessions').create({
      ...data,
      created_at: now,
    })
  } catch (error) {
    if (isMissingCollectionError(error)) return
    throw error
  }
}

export async function deleteSessionRecord(pb: PocketBase, sessionId: string): Promise<void> {
  const escapedSessionId = sessionId.replaceAll('"', '\\"')
  const records = await pb.collection('sessions').getFullList({
    filter: `session_id = "${escapedSessionId}"`,
  }).catch((error: unknown) => {
    if (isMissingCollectionError(error)) return []
    throw error
  })

  for (const record of records) {
    await pb.collection('sessions').delete(record.id)
  }
}

export async function listSessionRecords(pb: PocketBase): Promise<StoredSession[]> {
  const records = await pb.collection('sessions').getFullList({
    sort: '-updated_at',
  }).catch((error: unknown) => {
    if (isMissingCollectionError(error)) return []
    throw error
  })
  return (records as unknown as SessionRecord[]).map(rowToStoredSession)
}

function isMissingCollectionError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 404
}
