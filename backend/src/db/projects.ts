import type PocketBase from 'pocketbase'
import type { Project } from '@subpolar/shared/types'
import { GENERAL_CHAT_PROJECT_ID } from '@subpolar/shared/utils'
import { getWorkspacePath } from '@subpolar/shared/config/env'
import path from 'path'

export interface ProjectRecord {
  id: string
  user_id: string
  name: string
  directory: string
  full_path?: string
  opencode_config_name?: string
  status: string
  is_temporary?: boolean
  is_general_chat?: boolean
  created_at: number
  updated_at: number
  last_accessed_at?: number
}

let projectFieldNames: Set<string> | null = null

async function getProjectFieldNames(pb: PocketBase): Promise<Set<string>> {
  if (projectFieldNames) return projectFieldNames

  const collection = await pb.collections.getOne('projects') as unknown as { fields?: Array<{ name: string }> }
  projectFieldNames = new Set((collection.fields ?? []).map((field) => field.name))
  return projectFieldNames
}

async function withExistingProjectFields<T extends Record<string, unknown>>(pb: PocketBase, data: T): Promise<Partial<T>> {
  const fields = await getProjectFieldNames(pb)
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => fields.has(key)),
  ) as Partial<T>
}

function rowToProject(row: ProjectRecord): Project {
  const isGeneralChat = row.is_general_chat ?? (row.user_id === 'default' && row.name === 'General Chat')
  const numId = isGeneralChat ? GENERAL_CHAT_PROJECT_ID : parseInt(row.id, 10)
  const fullPath = isGeneralChat ? path.join(getWorkspacePath(), 'general-chat') : row.full_path ?? row.directory
  return {
    id: numId,
    name: row.name,
    directory: row.directory || '',
    fullPath,
    openCodeConfigName: row.opencode_config_name,
    status: (row.status as Project['status']) || 'ready',
    isGeneralChat,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
  }
}

export async function listProjects(pb: PocketBase, userId: string): Promise<Project[]> {
  const result = await pb.collection('projects').getFullList({
    sort: '-created_at',
    filter: `user_id = "${userId}"`,
  })
  return (result as unknown as ProjectRecord[])
    .filter((r) => !isGeneralChatRecord(r))
    .map(rowToProject)
}

function isGeneralChatRecord(row: ProjectRecord): boolean {
  return row.is_general_chat === true || row.name === 'General Chat' || row.directory === 'general-chat'
}

export async function getProjectById(pb: PocketBase, id: string): Promise<Project | null> {
  if (id === String(GENERAL_CHAT_PROJECT_ID)) {
    return getGeneralChatProject(pb)
  }

  try {
    const record = await pb.collection('projects').getOne(id)
    return rowToProject(record as unknown as ProjectRecord)
  } catch {
    return null
  }
}

async function findGeneralChatRecord(pb: PocketBase): Promise<ProjectRecord | null> {
  const fields = await getProjectFieldNames(pb)
  const filters = fields.has('is_general_chat')
    ? ['is_general_chat = true', 'user_id = "default" && name = "General Chat"', 'name = "General Chat"']
    : ['user_id = "default" && name = "General Chat"', 'name = "General Chat"']

  for (const filter of filters) {
    const record = await pb.collection('projects').getFirstListItem(filter, { sort: 'created_at' }).catch(() => null)
    if (record) return record as unknown as ProjectRecord
  }

  return null
}

export async function getGeneralChatProject(pb: PocketBase): Promise<Project | null> {
  const record = await findGeneralChatRecord(pb)
  return record ? rowToProject(record) : null
}

export async function ensureGeneralChatProject(pb: PocketBase): Promise<Project> {
  const existing = await findGeneralChatRecord(pb)
  if (existing) {
    return rowToProject(existing)
  }
  const now = Date.now()
  const record = await pb.collection('projects').create(await withExistingProjectFields(pb, {
    user_id: 'default',
    name: 'General Chat',
    directory: 'general-chat',
    full_path: path.join(getWorkspacePath(), 'general-chat'),
    status: 'ready',
    is_general_chat: true,
    is_temporary: false,
    created_at: now,
    updated_at: now,
    last_accessed_at: now,
  }))
  return rowToProject(record as unknown as ProjectRecord)
}

export async function createProject(
  pb: PocketBase,
  data: {
    userId: string
    name: string
    directory?: string
    fullPath?: string
    openCodeConfigName?: string
    isTemporary?: boolean
  },
): Promise<Project> {
  const now = Date.now()
  const dir = data.directory ?? data.name
  const record = await pb.collection('projects').create(await withExistingProjectFields(pb, {
    user_id: data.userId,
    name: data.name,
    directory: dir,
    full_path: data.fullPath ?? dir,
    opencode_config_name: data.openCodeConfigName ?? null,
    status: 'ready',
    is_temporary: data.isTemporary ?? false,
    is_general_chat: false,
    created_at: now,
    updated_at: now,
  }))
  return rowToProject(record as unknown as ProjectRecord)
}

export async function updateProject(
  pb: PocketBase,
  id: string,
  data: { name?: string; directory?: string; openCodeConfigName?: string },
): Promise<Project | null> {
  const existing = await getProjectById(pb, id)
  if (!existing) return null
  const record = await pb.collection('projects').update(id, {
    name: data.name ?? existing.name,
    directory: data.directory !== undefined ? data.directory : existing.directory,
    opencode_config_name: data.openCodeConfigName !== undefined ? data.openCodeConfigName : existing.openCodeConfigName,
    updated_at: Date.now(),
  })
  return rowToProject(record as unknown as ProjectRecord)
}

export async function deleteProject(pb: PocketBase, id: string): Promise<boolean> {
  try {
    const pbId = id === '0' ? '0' : id
    const jobs = await pb.collection('automation_jobs').getFullList({
      filter: `repo_id = "${pbId}"`,
    })
    for (const job of jobs) {
      const runs = await pb.collection('automation_runs').getFullList({
        filter: `repo_id = "${pbId}" && job_id = "${job.id}"`,
      })
      for (const run of runs) {
        await pb.collection('automation_runs').delete(run.id)
      }
      await pb.collection('automation_jobs').delete(job.id)
    }
    await pb.collection('projects').delete(pbId)
    return true
  } catch {
    return false
  }
}

export async function updateProjectLastAccessed(pb: PocketBase, id: string): Promise<void> {
  try {
    const recordId = await resolveProjectRecordId(pb, id)
    await pb.collection('projects').update(recordId, await withExistingProjectFields(pb, { last_accessed_at: Date.now() }))
  } catch {
    throw new Error(`Project with id ${id} not found`)
  }
}

export async function updateProjectConfigName(pb: PocketBase, id: string, configName: string): Promise<void> {
  try {
    const recordId = await resolveProjectRecordId(pb, id)
    await pb.collection('projects').update(recordId, await withExistingProjectFields(pb, { opencode_config_name: configName }))
  } catch {
    throw new Error(`Project with id ${id} not found`)
  }
}

async function resolveProjectRecordId(pb: PocketBase, id: string): Promise<string> {
  if (id !== String(GENERAL_CHAT_PROJECT_ID)) return id
  const record = await findGeneralChatRecord(pb)
  if (!record) throw new Error(`Project with id ${id} not found`)
  return record.id
}
