import { describe, it, expect, beforeEach, vi } from 'bun:test'
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

describe('internal/notifications routes', () => {
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

  it('POST /api/internal/notifications/send returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/internal/notifications/send returns 401 with invalid bearer token', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer invalid-token',
      },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/internal/notifications/send returns 503 when VAPID not configured', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(503)
  })

  it('POST /api/internal/notifications/send returns 200 with valid request (no subscriptions)', async () => {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { delivered: number; expired: number; failed: number; noSubscriptions: boolean }
    expect(body.delivered).toBe(0)
    expect(body.expired).toBe(0)
    expect(body.failed).toBe(0)
    expect(body.noSubscriptions).toBe(true)
  })

  it('POST /api/internal/notifications/send returns 400 on invalid body (missing title)', async () => {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)

    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/internal/notifications/send returns 400 on title > 120 chars', async () => {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)

    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'a'.repeat(121), body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/internal/notifications/send returns 400 on body > 500 chars', async () => {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)

    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'b'.repeat(501) }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/internal/notifications/send returns 400 on url > 500 chars', async () => {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body', url: 'u'.repeat(501) }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/internal/notifications/send returns 429 after 10 calls within rate window', async () => {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    const makeRequest = async () => {
      return app.request('/api/internal/notifications/send', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test', body: 'Body' }),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
      })
    }

    for (let i = 0; i < 10; i++) {
      const res = await makeRequest()
      expect(res.status).toBe(200)
    }

    const res = await makeRequest()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})
