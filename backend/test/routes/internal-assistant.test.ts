import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type PocketBase from 'pocketbase'
import { createInternalRoutes } from '../../src/routes/internal'
import { AutomationService } from '../../src/services/automations'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { getGeneralChatDirectory } from '../../src/services/general-chat'
import type { OpenCodeClient } from '../../src/services/opencode/client'

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

describe('internal/assistant routes', () => {
  let pb: PocketBase
  let automationservice: AutomationService
  let notificationService: NotificationService
  let settingsService: SettingsService
  let app: Hono
  let token: string
  let forwardMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    pb = createMockPocketBase()

    forwardMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    const openCodeClient = {
      forward: forwardMock,
      forwardRaw: vi.fn(),
      getJson: vi.fn(),
      postJson: vi.fn(),
      setProviderAuth: vi.fn(),
      deleteProviderAuth: vi.fn(),
      startMcpAuth: vi.fn(),
      authenticateMcp: vi.fn(),
    } as unknown as OpenCodeClient

    automationservice = new AutomationService(pb, openCodeClient)
    notificationService = new NotificationService(pb)
    settingsService = new SettingsService(pb)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(pb, automationservice, notificationService, settingsService, openCodeClient))
    token = await getOrCreateInternalToken(pb)
  })

  it('POST /api/internal/assistant/reload returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/assistant/reload', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('POST /api/internal/assistant/reload returns 200 with valid token', async () => {
    const res = await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean }
    expect(body.success).toBe(true)
  })

  it('forwards POST /instance/dispose with correct directory', async () => {
    await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(forwardMock).toHaveBeenCalledTimes(1)
    expect(forwardMock).toHaveBeenCalledWith({
      method: 'POST',
      path: '/instance/dispose',
      directory: getGeneralChatDirectory(),
    })
  })

  it('returns 429 after exceeding rate limit (5 calls/min)', async () => {
    const results: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await app.request('/api/internal/assistant/reload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      results.push(res.status)
    }

    // First 5 should succeed
    expect(results.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    // 6th should be rate limited
    expect(results[5]).toBe(429)
  })

  it('429 response includes Retry-After header', async () => {
    // Burn through the 5 allowed calls
    for (let i = 0; i < 5; i++) {
      await app.request('/api/internal/assistant/reload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    }

    const res = await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('returns 502 when OpenCode responds non-2xx', async () => {
    forwardMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 }),
    )
    const res = await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Failed to reload assistant workspace')
  })
})
