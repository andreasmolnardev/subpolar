import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type PocketBase from 'pocketbase'
import { createInternalRoutes } from '../../src/routes/internal'
import { AutomationService } from '../../src/services/automations'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createRepo } from '../../src/db/queries'
import type { CreateRepoInput } from '../../src/types/repo'

function createMockPocketBase(): PocketBase {
  const appSecrets = new Map<string, { value: string; created_at: number; updated_at: number }>()
  const repos = new Map<string, Record<string, unknown>>()
  const prefs = new Map<string, { user_id: string; preferences: string; updated_at: number }>()
  let idCounter = 0

  return {
    collection: (name: string) => {
      const collections: Record<string, Map<string, Record<string, unknown>>> = {
        app_secrets: appSecrets,
        repos,
        user_preferences: prefs,
      }
      const col = collections[name] || new Map()

      return {
        getOne: async <T = unknown>(id: string): Promise<T> => {
          const record = col.get(id)
          if (!record) throw new Error('Not found')
          return record as unknown as T
        },
        getFirstListItem: async <T = unknown>(filter: string): Promise<T> => {
          const key = filter.match(/key\s*=\s*"([^"]+)"/)?.[1]
          if (key && name === 'app_secrets') {
            const record = col.get(key)
            if (record) return { id: String(++idCounter), ...record } as unknown as T
          }
          const userId = filter.match(/user_id\s*=\s*"([^"]+)"/)?.[1]
          if (userId && name === 'user_preferences') {
            for (const record of col.values()) {
              if ((record as Record<string, unknown>).user_id === userId) {
                return record as unknown as T
              }
            }
          }
          if (name === 'repos') {
            const localPath = filter.match(/local_path\s*=\s*"([^"]+)"/)?.[1]
            if (localPath) {
              for (const record of col.values()) {
                if ((record as Record<string, unknown>).local_path === localPath) {
                  return record as unknown as T
                }
              }
            }
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
          const key = data.key as string
          if (key && name === 'app_secrets') {
            appSecrets.set(key, { value: data.value as string, created_at: data.created_at as number, updated_at: data.updated_at as number })
            const id = data.id as string || String(++idCounter)
            return { id, ...data } as unknown as T
          }
          if (name === 'user_preferences') {
            const userId = data.user_id as string
            prefs.set(userId, { user_id: userId, preferences: data.preferences as string, updated_at: data.updated_at as number })
            const id = data.id as string || String(++idCounter)
            return { id, ...data } as unknown as T
          }
          idCounter++
          const id = data.id as string || String(idCounter)
          col.set(id, { ...data, id })
          return { id, ...data } as unknown as T
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

describe('internal-repos routes', () => {
  let pb: PocketBase
  let automationservice: AutomationService
  let notificationService: NotificationService
  let settingsService: SettingsService
  let app: Hono
  let token: string

  beforeEach(async () => {
    pb = createMockPocketBase()
    const openCodeClient = createOpenCodeClient()
    automationservice = new AutomationService(pb, openCodeClient)
    notificationService = new NotificationService(pb)
    settingsService = new SettingsService(pb)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(pb, automationservice, notificationService, settingsService, openCodeClient))
    token = await getOrCreateInternalToken(pb)
  })

  it('GET /api/internal/repos returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/repos returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/repos', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { repos: unknown[] }
    expect(body).toHaveProperty('repos')
    expect(Array.isArray(body.repos)).toBe(true)
  })

  it('GET /api/internal/repos returns repos in default order', async () => {
    const repo1Input: CreateRepoInput = {
      localPath: 'repo1',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    const repo2Input: CreateRepoInput = {
      localPath: 'repo2',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    await createRepo(pb, repo1Input)
    await createRepo(pb, repo2Input)

    const res = await app.request('/api/internal/repos', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { repos: Array<{ id: number; localPath: string }> }
    expect(body.repos.length).toBe(2)
  })

  it('GET /api/internal/repos respects repoOrder preference', async () => {
    const repo1Input: CreateRepoInput = {
      localPath: 'repo1',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    const repo2Input: CreateRepoInput = {
      localPath: 'repo2',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    const repo1 = await createRepo(pb, repo1Input)
    const repo2 = await createRepo(pb, repo2Input)

    await settingsService.updateSettings({
      repoOrder: [repo2.id, repo1.id],
    })

    const res = await app.request('/api/internal/repos', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { repos: Array<{ id: number; localPath: string }> }
    expect(body.repos.length).toBe(2)
    expect(body.repos[0]?.id).toBe(repo2.id)
    expect(body.repos[1]?.id).toBe(repo1.id)
  })

  it('GET /api/internal/repos/:id/automations still works after adding repos route', async () => {
    const repoInput: CreateRepoInput = {
      localPath: 'test-repo',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    const repo = await createRepo(pb, repoInput)

    const res = await app.request(`/api/internal/repos/${repo.id}/automations`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { jobs: unknown[] }
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.jobs)).toBe(true)
  })
})
