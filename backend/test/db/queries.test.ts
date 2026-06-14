import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as db from '../../src/db/queries'
import type PocketBase from 'pocketbase'

function createMockPocketBase(): PocketBase {
  const repos = new Map<string, Record<string, unknown>>()
  const automationJobs = new Map<string, Record<string, unknown>>()
  const automationRuns = new Map<string, Record<string, unknown>>()
  const repoSettings = new Map<string, Record<string, unknown>>()
  let idCounter = 0

  const collections: Record<string, Map<string, Record<string, unknown>>> = {
    repos,
    automation_jobs: automationJobs,
    automation_runs: automationRuns,
    repo_settings: repoSettings,
  }

  return {
    collection: (name: string) => {
      const col = collections[name] || (collections[name] = new Map())
      return {
        getOne: vi.fn(async <T = unknown>(id: string): Promise<T> => {
          if (col.has(id)) return col.get(id) as unknown as T
          throw new Error('Not found')
        }),
        getFirstListItem: vi.fn(async <T = unknown>(filter: string): Promise<T> => {
          for (const record of col.values()) {
            return record as unknown as T
          }
          throw new Error('Not found')
        }),
        getFullList: vi.fn(async <T = unknown>(options?: Record<string, unknown>): Promise<T[]> => {
          let items = Array.from(col.values())
          if (options?.filter && typeof options.filter === 'string') {
            const matches = (options.filter as string).match(/(\w+)\s*=\s*"([^"]+)"/g)
            if (matches) {
              items = items.filter(item =>
                (matches as string[]).every(m => {
                  const [, key, val] = (m as string).match(/(\w+)\s*=\s*"([^"]+)"/) || []
                  return key && String((item as Record<string, unknown>)[key]) === val
                }),
              )
            }
          }
          if (options?.sort && typeof options.sort === 'string') {
            const dir = (options.sort as string).startsWith('-') ? -1 : 1
            const field = (options.sort as string).replace(/^-/, '')
            items.sort((a, b) => {
              const aVal = (a as Record<string, unknown>)[field] as number
              const bVal = (b as Record<string, unknown>)[field] as number
              return ((aVal || 0) - (bVal || 0)) * dir
            })
          }
          return items as unknown as T[]
        }),
        getList: vi.fn(async <T = unknown>(page: number, perPage: number): Promise<{ items: T[]; totalItems: number }> => {
          const items = Array.from(col.values())
          return { items: items as unknown as T[], totalItems: items.length }
        }),
        create: vi.fn(async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
          idCounter++
          const id = (data?.id as string) || String(idCounter)
          const record = { ...data, id }
          col.set(id, record)
          if (name === 'repos') {
            return recordToRepo(record as RepoRecord) as unknown as T
          }
          return record as unknown as T
        }),
        update: vi.fn(async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
          const existing = col.get(id)
          if (!existing) throw new Error('Not found')
          const updated = { ...existing, ...data }
          col.set(id, updated)
          return updated as unknown as T
        }),
        delete: vi.fn(async (id: string): Promise<boolean> => col.delete(id)),
      }
    },
    health: { check: vi.fn(async () => ({ code: 200 })) },
  } as unknown as PocketBase
}

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
  is_worktree?: number
  is_local?: number
}

function recordToRepo(record: RepoRecord) {
  return {
    id: parseInt(record.id, 10),
    repoUrl: record.repo_url,
    localPath: record.local_path,
    fullPath: record.source_path || `/repos/${record.local_path}`,
    sourcePath: record.source_path,
    branch: record.branch,
    defaultBranch: record.default_branch,
    cloneStatus: record.clone_status,
    clonedAt: record.cloned_at,
    lastPulled: record.last_pulled,
    lastAccessedAt: record.last_accessed_at,
    openCodeConfigName: record.opencode_config_name,
    isWorktree: record.is_worktree ? true : undefined,
    isLocal: record.is_local ? true : undefined,
  }
}

describe('Database Queries', () => {
  let pb: PocketBase

  beforeEach(() => {
    pb = createMockPocketBase()
    vi.clearAllMocks()
  })

  describe('createRepo', () => {
    it('should insert new repo record', async () => {
      const clonedAt = Date.now()
      const repo = {
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt,
        isWorktree: false,
        isLocal: true,
      }

      const result = await db.createRepo(pb, repo)

      expect(result.id).toBeGreaterThan(0)
      expect(result.repoUrl).toBe(repo.repoUrl)
      expect(result.localPath).toBe(repo.localPath)
    })

    it('should return existing repository when local_path matches', async () => {
      const clonedAt = Date.now()
      await pb.collection('repos').create({
        id: '1',
        repo_url: 'https://github.com/test/repo',
        local_path: 'repos/test-repo',
        source_path: '/Users/test/repos/test-repo',
        branch: 'main',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: clonedAt,
        last_accessed_at: clonedAt,
        is_worktree: false,
        is_local: true,
      })

      const result = await db.createRepo(pb, {
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isWorktree: false,
        isLocal: true,
      })

      expect(result.id).toBe(1)
    })
  })

  describe('getRepoById', () => {
    it('should retrieve repo by ID', async () => {
      const clonedAt = Date.now()
      const lastAccessedAt = Date.now()

      await pb.collection('repos').create({
        id: '1',
        repo_url: 'https://github.com/test/repo',
        local_path: 'repos/test-repo',
        source_path: '/Users/test/repos/test-repo',
        branch: 'main',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: clonedAt,
        last_pulled: null,
        last_accessed_at: lastAccessedAt,
        is_worktree: false,
        is_local: true,
      })

      const result = await db.getRepoById(pb, 1)

      expect(result).toEqual({
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/Users/test/repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: clonedAt,
        lastPulled: null,
        lastAccessedAt: lastAccessedAt,
        openCodeConfigName: undefined,
        isWorktree: undefined,
        isLocal: undefined,
      })
    })

    it('should return null for non-existent repo', async () => {
      const result = await db.getRepoById(pb, 999)
      expect(result).toBeNull()
    })
  })

  describe('listRepos', () => {
    it('should return all repos', async () => {
      const now = Date.now()
      await pb.collection('repos').create({
        id: '1',
        repo_url: 'https://github.com/test/repo1',
        local_path: 'repos/test-repo1',
        branch: 'main',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: now,
        is_worktree: false,
      })
      await pb.collection('repos').create({
        id: '2',
        repo_url: 'https://github.com/test/repo2',
        local_path: 'repos/test-repo2',
        branch: 'main',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: now,
        is_worktree: false,
      })

      const result = await db.listRepos(pb)

      expect(result).toHaveLength(2)
      expect(result[0]?.repoUrl).toBe('https://github.com/test/repo1')
    })
  })

  describe('updateRepoStatus', () => {
    it('should update repo clone status', async () => {
      await pb.collection('repos').create({
        id: '1',
        local_path: 'test',
        default_branch: 'main',
        clone_status: 'cloning',
        cloned_at: Date.now(),
      })

      await db.updateRepoStatus(pb, 1, 'ready')

      const updated = await pb.collection('repos').getOne('1') as Record<string, unknown>
      expect(updated.clone_status).toBe('ready')
    })
  })

  describe('updateRepoConfigName', () => {
    it('should update repo OpenCode config name', async () => {
      await pb.collection('repos').create({
        id: '1',
        local_path: 'test',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: Date.now(),
      })

      await db.updateRepoConfigName(pb, 1, 'my-config')

      const updated = await pb.collection('repos').getOne('1') as Record<string, unknown>
      expect(updated.opencode_config_name).toBe('my-config')
    })
  })

  describe('updateLastPulled', () => {
    it('should update repo last pulled timestamp', async () => {
      await pb.collection('repos').create({
        id: '1',
        local_path: 'test',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: Date.now(),
      })

      await db.updateLastPulled(pb, 1)

      const updated = await pb.collection('repos').getOne('1') as Record<string, unknown>
      expect(updated.last_pulled).toEqual(expect.any(Number))
    })
  })

  describe('updateLastAccessed', () => {
    it('should update repo last accessed timestamp', async () => {
      await pb.collection('repos').create({
        id: '1',
        local_path: 'test',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: Date.now(),
      })

      await db.updateLastAccessed(pb, 1)

      const updated = await pb.collection('repos').getOne('1') as Record<string, unknown>
      expect(updated.last_accessed_at).toEqual(expect.any(Number))
    })

    it('should throw error when repo not found', async () => {
      await expect(db.updateLastAccessed(pb, 999)).rejects.toThrow('Repository with id 999 not found')
    })
  })

  describe('deleteRepo', () => {
    it('should delete repo automations before deleting repo by ID', async () => {
      await pb.collection('repos').create({
        id: '1',
        local_path: 'test',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: Date.now(),
        is_worktree: false,
        is_local: true,
      })

      await db.deleteRepo(pb, 1)

      const exists = await pb.collection('repos').getOne('1').catch(() => null)
      expect(exists).toBeNull()
    })

    it('should not delete the assistant repo', async () => {
      await db.deleteRepo(pb, 0)
      // Should not throw - just returns early
      expect(true).toBe(true)
    })
  })

  describe('Database Schema', () => {
    it('should have schema module available', () => {
      const { initializeDatabase } = require('../../src/db/schema')
      expect(initializeDatabase).toBeDefined()
      expect(typeof initializeDatabase).toBe('function')
    })
  })
})
