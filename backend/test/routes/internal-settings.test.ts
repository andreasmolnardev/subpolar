import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import type PocketBase from 'pocketbase'
import { createInternalRoutes } from '../../src/routes/internal'
import { AutomationService } from '../../src/services/automations'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import type { UserPreferences } from '@subpolar/shared/types'

function createMockPocketBase(): PocketBase {
  const appSecrets = new Map<string, { value: string; created_at: number; updated_at: number }>()
  const prefs = new Map<string, { preferences: string; updated_at: number }>()
  let idCounter = 0

  return {
    collection: (name: string) => {
      const collections: Record<string, Map<string, Record<string, unknown>>> = {
        app_secrets: appSecrets,
        user_preferences: prefs,
      }
      const col = collections[name] || new Map()

      return {
        getOne: async <T = unknown>(): Promise<T> => { throw new Error('Not found') },
        getFirstListItem: async <T = unknown>(filter: string): Promise<T> => {
          const key = filter.match(/key\s*=\s*"([^"]+)"/)?.[1]
          if (key && name === 'app_secrets') {
            const record = col.get(key)
            if (record) return { id: String(++idCounter), ...record } as unknown as T
          }
          const userId = filter.match(/user_id\s*=\s*"([^"]+)"/)?.[1]
          if (userId && name === 'user_preferences') {
            const record = col.get(userId)
            if (record) return { id: String(++idCounter), user_id: userId, ...record } as unknown as T
          }
          throw new Error('Not found')
        },
        create: async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
          const key = data.key as string
          if (key && name === 'app_secrets') {
            appSecrets.set(key, { value: data.value as string, created_at: data.created_at as number, updated_at: data.updated_at as number })
          } else if (name === 'user_preferences') {
            const userId = data.user_id as string
            prefs.set(userId, { preferences: data.preferences as string, updated_at: data.updated_at as number })
          }
          return { id: String(++idCounter), ...data } as unknown as T
        },
        update: async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
          return { id, ...data } as unknown as T
        },
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

describe('internal/settings routes', () => {
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

  it('GET /api/internal/settings returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/settings')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/settings returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: unknown; updatedAt: number }
    expect(body).toHaveProperty('preferences')
    expect(body).toHaveProperty('updatedAt')
  })

  it('GET /api/internal/settings returns merged defaults', async () => {
    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { theme: string; mode: string } }
    expect(body.preferences.theme).toBe('dark')
    expect(body.preferences.mode).toBe('build')
  })

  it('PATCH /api/internal/settings returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'dark' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('PATCH /api/internal/settings with { theme: "dark" } persists and returns new settings', async () => {
    const patchRes = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'dark' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(patchRes.status).toBe(200)

    const getRes = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(getRes.status).toBe(200)
    const body = await getRes.json() as { preferences: { theme: string } }
    expect(body.preferences.theme).toBe('dark')
  })

  it('PATCH /api/internal/settings with { gitCredentials: [...] } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ gitCredentials: [{ name: 'test', token: 'secret' }] }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { tts: { apiKey: "secret" } } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ tts: { apiKey: 'secret' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { theme: "rainbow" } returns 400 (enum reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'rainbow' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { stt: { model: "whisper-1" } } preserves non-default language and omitted fields', async () => {
    // Seed full STT config with a non-default language
    settingsService.updateSettings({
      stt: {
        enabled: true,
        provider: 'builtin',
        endpoint: 'https://api.openai.com',
        apiKey: 'sk-secret-456',
        model: 'whisper-1',
        language: 'fr-FR',
      },
    } as Partial<UserPreferences>)

    // Patch only model — language, provider, enabled must remain as seeded
    const patchRes = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ stt: { model: 'whisper-2' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as { preferences: { stt: { model: string; language: string; provider: string; enabled: boolean } } }
    expect(body.preferences.stt.model).toBe('whisper-2')
    expect(body.preferences.stt.language).toBe('fr-FR')  // must NOT reset to default 'en-US'
    expect(body.preferences.stt.provider).toBe('builtin') // preserved
    expect(body.preferences.stt.enabled).toBe(true)        // preserved
  })

  it('PATCH /api/internal/settings with { stt: { ... } } when no stt config exists returns 400', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ stt: { enabled: true, language: 'fr-FR' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('STT is not configured')
  })

  it('PATCH /api/internal/settings with existing keys (theme) still works after tts/stt additions', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'light', mode: 'plan' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { theme: string; mode: string } }
    expect(body.preferences.theme).toBe('light')
    expect(body.preferences.mode).toBe('plan')
  })
})
