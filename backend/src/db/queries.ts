import type PocketBase from 'pocketbase'
import type { Repo } from '../types/repo'
import { getReposPath } from '@subpolar/shared/config/env'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_PATH } from '@subpolar/shared/utils'
import { getErrorMessage } from '../utils/error-utils'
import path from 'path'

interface RepoRecord {
  id: string
  repo_url?: string
  local_path: string
  source_path?: string
  branch?: string
  default_branch: string
  clone_status: string
  cloned_at: number
  last_pulled?: number
  last_accessed_at?: number
  opencode_config_name?: string
  is_worktree?: boolean
  is_local?: boolean
}

function getNextRepoId(pb: PocketBase): Promise<number> {
  return pb.collection('repos').getList(1, 1, {
    sort: '-created',
    fields: 'id',
  }).then((result) => {
    if (result.items.length === 0) return 1
    const maxId = Math.max(...result.items.map((r: { id: string }) => parseInt(r.id, 10) || 0))
    return maxId + 1
  })
}

function recordToRepo(record: RepoRecord): Repo {
  const fullPath = record.source_path || path.join(getReposPath(), record.local_path)
  const numId = parseInt(record.id, 10)

  return {
    id: isNaN(numId) ? ASSISTANT_REPO_ID : numId,
    repoUrl: record.repo_url,
    localPath: record.local_path,
    fullPath,
    sourcePath: record.source_path,
    branch: record.branch,
    defaultBranch: record.default_branch,
    cloneStatus: record.clone_status as Repo['cloneStatus'],
    clonedAt: record.cloned_at,
    lastPulled: record.last_pulled,
    lastAccessedAt: record.last_accessed_at,
    openCodeConfigName: record.opencode_config_name,
    isWorktree: record.is_worktree ?? undefined,
    isLocal: record.is_local ?? undefined,
  }
}

function toPocketBaseId(numId: number): string {
  return String(numId)
}

const TABLES_WITH_REPO_ID = ['automation_jobs', 'automation_runs', 'repo_settings'] as const

export async function getRepoById(pb: PocketBase, id: number): Promise<Repo | null> {
  try {
    const record = await pb.collection('repos').getOne(toPocketBaseId(id))
    return recordToRepo(record as unknown as RepoRecord)
  } catch {
    return null
  }
}

export async function ensureAssistantRepo(pb: PocketBase): Promise<Repo> {
  const existing = await pb.collection('repos').getFirstListItem(`local_path = "${ASSISTANT_REPO_PATH}"`).catch(() => null)
  const now = Date.now()

  if (existing) {
    return recordToRepo(existing as unknown as RepoRecord)
  }

  const record = await pb.collection('repos').create({
    repo_url: null,
    local_path: ASSISTANT_REPO_PATH,
    source_path: null,
    branch: null,
    default_branch: 'main',
    clone_status: 'ready',
    cloned_at: now,
    last_accessed_at: now,
    is_worktree: false,
    is_local: false,
  })

  return recordToRepo(record as unknown as RepoRecord)
}

export async function createRepo(pb: PocketBase, input: { repoUrl?: string; localPath: string; sourcePath?: string; branch?: string; defaultBranch: string; cloneStatus: string; clonedAt: number; isWorktree?: boolean; isLocal?: boolean }): Promise<Repo> {
  const normalizedPath = input.localPath.trim().replace(/\/+$/, '')

  const existing = input.isLocal
    ? input.sourcePath
      ? await getRepoBySourcePath(pb, input.sourcePath) ?? await getRepoByLocalPath(pb, normalizedPath)
      : await getRepoByLocalPath(pb, normalizedPath)
    : await getRepoByUrlAndBranch(pb, input.repoUrl!, input.branch)

  if (existing) return existing

  const nextId = await getNextRepoId(pb)

  try {
    const record = await pb.collection('repos').create({
      id: toPocketBaseId(nextId),
      repo_url: input.repoUrl || null,
      local_path: normalizedPath,
      source_path: input.sourcePath || null,
      branch: input.branch || null,
      default_branch: input.defaultBranch,
      clone_status: input.cloneStatus,
      cloned_at: input.clonedAt,
      last_accessed_at: input.clonedAt,
      is_worktree: input.isWorktree ?? false,
      is_local: input.isLocal ?? false,
    })
    return recordToRepo(record as unknown as RepoRecord)
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error)
    if (errorMessage.includes('UNIQUE constraint failed')) {
      const conflictRepo = input.isLocal
        ? input.sourcePath
          ? await getRepoBySourcePath(pb, input.sourcePath) ?? await getRepoByLocalPath(pb, normalizedPath)
          : await getRepoByLocalPath(pb, normalizedPath)
        : await getRepoByUrlAndBranch(pb, input.repoUrl!, input.branch)

      if (conflictRepo) return conflictRepo

      const identifier = input.isLocal ? `path '${normalizedPath}'` : `url '${input.repoUrl}' branch '${input.branch || 'default'}'`
      throw new Error(`Repository with ${identifier} already exists but could not be retrieved.`)
    }
    throw new Error(`Failed to create repository: ${errorMessage}`)
  }
}

export async function getRepoByUrlAndBranch(pb: PocketBase, repoUrl: string, branch?: string): Promise<Repo | null> {
  try {
    const filter = branch
      ? `repo_url = "${repoUrl}" && branch = "${branch}"`
      : `repo_url = "${repoUrl}" && branch = null`
    const record = await pb.collection('repos').getFirstListItem(filter)
    return recordToRepo(record as unknown as RepoRecord)
  } catch {
    return null
  }
}

export async function getRepoByLocalPath(pb: PocketBase, localPath: string): Promise<Repo | null> {
  try {
    const record = await pb.collection('repos').getFirstListItem(`local_path = "${localPath}"`)
    return recordToRepo(record as unknown as RepoRecord)
  } catch {
    return null
  }
}

export async function getRepoBySourcePath(pb: PocketBase, sourcePath: string): Promise<Repo | null> {
  try {
    const record = await pb.collection('repos').getFirstListItem(`source_path = "${sourcePath}"`)
    return recordToRepo(record as unknown as RepoRecord)
  } catch {
    return null
  }
}

export async function listRepos(pb: PocketBase, repoOrder?: number[]): Promise<Repo[]> {
  const result = await pb.collection('repos').getFullList({ sort: '-cloned_at' })
  const repos = (result as unknown as RepoRecord[]).map(recordToRepo)

  if (!repoOrder || repoOrder.length === 0) return repos

  const orderMap = new Map(repoOrder.map((id, index) => [id, index]))
  const orderedRepos = repos
    .filter((repo) => orderMap.has(repo.id))
    .sort((a, b) => orderMap.get(a.id)! - orderMap.get(b.id)!)

  const remainingRepos = repos
    .filter((repo) => !orderMap.has(repo.id))
    .sort((a, b) => {
      const nameA = getRepoName(a).toLowerCase()
      const nameB = getRepoName(b).toLowerCase()
      return nameA.localeCompare(nameB)
    })

  return [...orderedRepos, ...remainingRepos]
}

function getRepoName(repo: Repo): string {
  return repo.repoUrl
    ? repo.repoUrl.split('/').slice(-1)[0]?.replace('.git', '') || repo.localPath
    : repo.sourcePath ? path.basename(repo.sourcePath) : repo.localPath
}

export async function updateRepoStatus(pb: PocketBase, id: number, cloneStatus: Repo['cloneStatus']): Promise<void> {
  try {
    await pb.collection('repos').update(toPocketBaseId(id), { clone_status: cloneStatus })
  } catch {
    throw new Error(`Repository with id ${id} not found`)
  }
}

export async function updateRepoConfigName(pb: PocketBase, id: number, configName: string): Promise<void> {
  try {
    await pb.collection('repos').update(toPocketBaseId(id), { opencode_config_name: configName })
  } catch {
    throw new Error(`Repository with id ${id} not found`)
  }
}

export async function updateLastPulled(pb: PocketBase, id: number): Promise<void> {
  try {
    await pb.collection('repos').update(toPocketBaseId(id), { last_pulled: Date.now() })
  } catch {
    throw new Error(`Repository with id ${id} not found`)
  }
}

export async function updateLastAccessed(pb: PocketBase, id: number): Promise<void> {
  try {
    await pb.collection('repos').update(toPocketBaseId(id), { last_accessed_at: Date.now() })
  } catch {
    throw new Error(`Repository with id ${id} not found`)
  }
}

export async function updateRepoBranch(pb: PocketBase, id: number, branch: string): Promise<void> {
  try {
    await pb.collection('repos').update(toPocketBaseId(id), { branch })
  } catch {
    throw new Error(`Repository with id ${id} not found`)
  }
}

export async function deleteRepo(pb: PocketBase, id: number): Promise<void> {
  if (id === ASSISTANT_REPO_ID) return

  const pbId = toPocketBaseId(id)

  for (const table of TABLES_WITH_REPO_ID) {
    const records = await pb.collection(table).getFullList({ filter: `repo_id = "${pbId}"` })
    for (const record of records) {
      await pb.collection(table).delete(record.id)
    }
  }

  try {
    await pb.collection('repos').delete(pbId)
  } catch {
    // ignore if already deleted
  }
}
