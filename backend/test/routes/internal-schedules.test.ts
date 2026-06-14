import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type PocketBase from 'pocketbase'
import { createInternalRoutes } from '../../src/routes/internal'
import { AutomationService } from '../../src/services/automations'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { getOrCreateInternalToken } from '../../src/services/internal-token'

function createMockPocketBase(): PocketBase {
  const appSecrets = new Map<string, { value: string; created_at: number; updated_at: number }>()
  let idCounter = 0

  return {
    collection: (name: string) => {
      const col = name === 'app_secrets' ? appSecrets : new Map<string, Record<string, unknown>>()
      return {
        getFirstListItem: async <T = unknown>(filter: string): Promise<T> => {
          const key = filter.match(/key\s*=\s*"([^"]+)"/)?.[1]
          if (key) {
            const record = col.get(key)
            if (record) return { id: String(++idCounter), ...record } as unknown as T
          }
          throw new Error('Not found')
        },
        create: async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
          const key = data.key as string
          col.set(key, { ...data } as { value: string; created_at: number; updated_at: number })
          return { id: String(++idCounter), ...data } as unknown as T
        },
        update: async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
          return { id, ...data } as unknown as T
        },
        getOne: async <T = unknown>(): Promise<T> => { throw new Error('Not found') },
        getFullList: async <T = unknown>(): Promise<T[]> => Array.from(col.values()) as unknown as T[],
        getList: async <T = unknown>(): Promise<{ items: T[]; totalItems: number }> => {
          const items = Array.from(col.values())
          return { items: items as unknown as T[], totalItems: items.length }
        },
        delete: async (): Promise<boolean> => true,
      }
    },
    health: { check: async () => ({ code: 200 }) },
  } as unknown as PocketBase
}

describe('internal-automations routes', () => {
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

  it('GET /api/internal/automations/all returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/automations/all')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/automations/all returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/automations/all', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { jobs: unknown[] }
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  it('GET /api/internal/automations/all/runs returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/automations/all/runs', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { runs: unknown[] }
    expect(body).toHaveProperty('runs')
  })

  it('POST /api/internal/repos/:id/automations/:jobId/run returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos/1/automations/1/run', {
      method: 'POST',
    })
    expect(res.status).toBe(401)
  })
})
