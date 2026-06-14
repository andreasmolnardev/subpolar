import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { Hono } from 'hono'
import type PocketBase from 'pocketbase'
import { createRepoRoutes } from './repos'
import { createRepo } from '../db/queries'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import type { GitAuthService } from '../services/git-auth'
import type { OpenCodeClient } from '../services/opencode/client'
import { getReposPath } from '@subpolar/shared/config/env'
import path from 'path'

const stubGitAuthService = {
  getGitEnvironment: () => ({}),
  getGitCredentials: async () => [],
} as unknown as GitAuthService

function createMockPocketBase(): PocketBase {
  const repos = new Map<string, Record<string, unknown>>()
  let idCounter = 0

  return {
    collection: (name: string) => {
      const col = name === 'repos' ? repos : new Map<string, Record<string, unknown>>()
      return {
        getOne: async <T = unknown>(id: string): Promise<T> => {
          const record = col.get(id)
          if (!record) throw new Error('Not found')
          return record as unknown as T
        },
        getFirstListItem: async <T = unknown>(): Promise<T> => {
          for (const record of col.values()) {
            return record as unknown as T
          }
          throw new Error('Not found')
        },
        getFullList: async <T = unknown>(options?: Record<string, unknown>): Promise<T[]> => {
          const items = Array.from(col.values())
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
        },
        getList: async <T = unknown>(page: number, perPage: number): Promise<{ items: T[]; totalItems: number }> => {
          const items = Array.from(col.values())
          return { items: items as unknown as T[], totalItems: items.length }
        },
        create: async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
          idCounter++
          const id = (data?.id as string) || String(idCounter)
          const record = { ...data, id }
          col.set(id, record)
          return record as unknown as T
        },
        update: async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
          const existing = col.get(id)
          if (!existing) throw new Error('Not found')
          const updated = { ...existing, ...data }
          col.set(id, updated)
          return updated as unknown as T
        },
        delete: async (id: string): Promise<boolean> => col.delete(id),
      }
    },
    health: { check: async () => ({ code: 200 }) },
  } as unknown as PocketBase
}

function createTestApp(pb: PocketBase, openCodeClient: OpenCodeClient = createStubOpenCodeClient({
  getJson: mock(async () => []) as any,
})): Hono {
  const app = new Hono()
  const automationservice = {
    createautomation: () => {},
    getautomationById: () => null,
    listautomations: () => [],
    updateautomation: () => {},
    deleteautomation: () => {},
    prepareRepoDelete: () => {},
  } as any
  app.route('/repos', createRepoRoutes(pb, stubGitAuthService, automationservice, openCodeClient))
  return app
}

describe('GET /api/repos/:id/siblings', () => {
  let pb: PocketBase
  let app: Hono

  beforeEach(() => {
    pb = createMockPocketBase()
    app = createTestApp(pb)
  })

  it('returns siblings including self with currentBranch', async () => {
    await createRepo(pb, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    await createRepo(pb, { localPath: 'repo-b', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    await createRepo(pb, { localPath: 'repo-c', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    await createRepo(pb, { localPath: 'repo-unrelated', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; currentBranch: string | null | undefined }>
    expect(data).toHaveLength(3)
    expect(data.map((d) => d.id).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('includes OpenCode workspaces that are not manager repo rows', async () => {
    await createRepo(pb, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    app = createTestApp(pb, createStubOpenCodeClient({
      getJson: mock(async () => ([{
        id: 'wrk_test',
        type: 'worktree',
        name: 'plugin-workspace',
        branch: 'plugin-branch',
        directory: '/tmp/plugin-workspace',
        projectID: 'commit-A',
      }])) as any,
    }))

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; workspaceId?: string; currentBranch?: string }>
    expect(data).toHaveLength(2)
    expect(data[1]).toMatchObject({
      id: -1,
      workspaceId: 'wrk_test',
      currentBranch: 'plugin-branch',
    })
  })

  it('deduplicates OpenCode workspaces with the same directory', async () => {
    await createRepo(pb, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    app = createTestApp(pb, createStubOpenCodeClient({
      getJson: mock(async () => ([
        {
          id: 'wrk_first',
          type: 'worktree',
          name: 'duplicate-workspace',
          branch: 'duplicate-branch',
          directory: '/tmp/duplicate-workspace',
          projectID: 'commit-A',
        },
        {
          id: 'wrk_second',
          type: 'worktree',
          name: 'duplicate-workspace',
          branch: 'duplicate-branch',
          directory: '/tmp/duplicate-workspace/',
          projectID: 'commit-A',
        },
      ])) as any,
    }))

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ workspaceId?: string }>
    expect(data.filter((entry) => entry.workspaceId)).toHaveLength(1)
    expect(data.some((entry) => entry.workspaceId === 'wrk_first')).toBe(true)
  })

  it('excludes a workspace pointing at the repo directory so it cannot be deleted', async () => {
    await createRepo(pb, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const repoDirectory = path.join(getReposPath(), 'repo-a')
    app = createTestApp(pb, createStubOpenCodeClient({
      getJson: mock(async () => ([{
        id: 'wrk_self',
        type: 'worktree',
        name: 'self-workspace',
        branch: 'main',
        directory: `${repoDirectory}/`,
        projectID: 'commit-A',
      }])) as any,
    }))

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; workspaceId?: string }>
    expect(data).toHaveLength(1)
    expect(data.some((d) => d.workspaceId === 'wrk_self')).toBe(false)
  })

  it('excludes a workspace that is a git main checkout so the main repo cannot be deleted', async () => {
    await createRepo(pb, { localPath: 'repo-wt', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    app = createTestApp(pb, createStubOpenCodeClient({
      getJson: mock(async () => ([
        {
          id: 'wrk_main',
          type: 'worktree',
          name: 'main-checkout',
          branch: 'dev',
          directory: '/Users/dev/main-repo',
          projectID: 'commit-A',
        },
        {
          id: 'wrk_linked',
          type: 'worktree',
          name: 'feature',
          branch: 'feature/x',
          directory: '/Users/dev/worktrees/feature-x',
          projectID: 'commit-A',
        },
      ])) as any,
    }))

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ workspaceId?: string }>
    expect(data.some((d) => d.workspaceId === 'wrk_main')).toBe(false)
    expect(data.some((d) => d.workspaceId === 'wrk_linked')).toBe(true)
  })

  it('excludes repos with non-matching projectID', async () => {
    await createRepo(pb, { localPath: 'repo-only', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    await createRepo(pb, { localPath: 'repo-other', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number }>
    expect(data).toHaveLength(1)
    expect(data[0]!.id).toBe(1)
  })

  it('returns empty when target has no projectID', async () => {
    await createRepo(pb, { localPath: 'repo-no-project', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('returns empty when target cloneStatus !== ready', async () => {
    await createRepo(pb, { localPath: 'repo-cloning', defaultBranch: 'main', cloneStatus: 'cloning', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('returns empty when target missing', async () => {
    const res = await app.request('/repos/9999/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('invalid id returns 400', async () => {
    const res = await app.request('/repos/abc/siblings')
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Invalid repo id')
  })
})

describe('DELETE /api/repos/:id/workspaces/:workspaceId', () => {
  let pb: PocketBase
  let captured: { path: string; directory?: string } | null

  beforeEach(() => {
    pb = createMockPocketBase()
    captured = null
  })

  it('forwards workspace delete to OpenCode with repo directory', async () => {
    await createRepo(pb, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const forward = mock(async (req: Parameters<OpenCodeClient['forward']>[0]) => {
      captured = { path: req.path, directory: req.directory }
      return new Response(JSON.stringify({ id: 'wrk_test' }), { status: 200 })
    })
    const app = createTestApp(pb, createStubOpenCodeClient({
      forward,
    }))

    const res = await app.request('/repos/1/workspaces/wrk_test', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(captured?.path).toBe('/experimental/workspace/wrk_test')
    expect(captured?.directory?.endsWith('/repos/repo-a')).toBe(true)
  })
})

describe('POST /api/repos/:id/workspaces', () => {
  let pb: PocketBase
  let captured: { path: string; directory?: string; body?: string } | null

  beforeEach(() => {
    pb = createMockPocketBase()
    captured = null
  })

  it('forwards workspace creation to OpenCode with repo directory', async () => {
    await createRepo(pb, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const forward = mock(async (req: Parameters<OpenCodeClient['forward']>[0]) => {
      captured = { path: req.path, directory: req.directory, body: req.body }
      return new Response(JSON.stringify({ id: 'wrk_test', type: 'worktree', directory: '/tmp/wrk-test' }), { status: 200 })
    })
    const app = createTestApp(pb, createStubOpenCodeClient({
      forward,
    }))

    const res = await app.request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(captured?.path).toBe('/experimental/workspace')
    expect(captured?.directory?.endsWith('/repos/repo-a')).toBe(true)
    expect(JSON.parse(captured?.body ?? '{}')).toEqual({ type: 'worktree', branch: null })
    expect(await res.json()).toMatchObject({ id: 'wrk_test', type: 'worktree' })
  })
})
