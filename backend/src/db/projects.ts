import type PocketBase from 'pocketbase'
import type { Project } from '@subpolar/shared/types'

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

function rowToProject(row: ProjectRecord): Project {
  const numId = parseInt(row.id, 10)
  return {
    id: numId,
    name: row.name,
    directory: row.directory || '',
    fullPath: row.full_path ?? row.directory,
    openCodeConfigName: row.opencode_config_name,
    status: (row.status as Project['status']) || 'ready',
    isGeneralChat: row.is_general_chat ?? false,
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
    .filter((r) => !r.is_general_chat)
    .map(rowToProject)
}

export async function getProjectById(pb: PocketBase, id: string): Promise<Project | null> {
  try {
    const record = await pb.collection('projects').getOne(id)
    return rowToProject(record as unknown as ProjectRecord)
  } catch {
    return null
  }
}

export async function ensureGeneralChatProject(pb: PocketBase): Promise<Project> {
  const existing = await pb.collection('projects').getFirstListItem('is_general_chat = true').catch(() => null)
  if (existing) {
    return rowToProject(existing as unknown as ProjectRecord)
  }
  const now = Date.now()
  const record = await pb.collection('projects').create({
    id: '0',
    user_id: 'default',
    name: 'General Chat',
    directory: 'general-chat',
    full_path: 'general-chat',
    status: 'ready',
    is_general_chat: true,
    is_temporary: false,
    created_at: now,
    updated_at: now,
    last_accessed_at: now,
  })
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
  const record = await pb.collection('projects').create({
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
  })
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
    await pb.collection('projects').update(id, { last_accessed_at: Date.now() })
  } catch {
    throw new Error(`Project with id ${id} not found`)
  }
}

export async function updateProjectConfigName(pb: PocketBase, id: string, configName: string): Promise<void> {
  try {
    await pb.collection('projects').update(id, { opencode_config_name: configName })
  } catch {
    throw new Error(`Project with id ${id} not found`)
  }
}
