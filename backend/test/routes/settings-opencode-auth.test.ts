import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type PocketBase from 'pocketbase'
import { Hono } from 'hono'
import { createSettingsRoutes } from '../../src/routes/settings'
import { encryptSecret } from '../../src/utils/crypto'
import { ENV } from '@subpolar/shared/config/env'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { GitAuthService } from '../../src/services/git-auth'

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    restart: vi.fn(),
    reloadConfig: vi.fn(),
    getVersion: vi.fn(),
    fetchVersion: vi.fn(),
    clearStartupError: vi.fn(),
    reinitializeBinDirectory: vi.fn(),
  },
  ConfigReloadError: class ConfigReloadError extends Error {
    validationIssues = []
    removedFields = []
  },
}))

describe('OpenCode Server Auth Routes', () => {
  let pb: PocketBase
  let app: Hono
  let originalPassword: string
  const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>
  const appSecrets = new Map<string, { value: string; created_at: number; updated_at: number }>()
  let idCounter = 0

  beforeEach(() => {
    originalPassword = ENV.OPENCODE.SERVER_PASSWORD
    setEnvPassword('')
    vi.clearAllMocks()
    appSecrets.clear()

    pb = {
      collection: (name: string) => {
        const col = name === 'app_secrets' ? appSecrets : new Map<string, Record<string, unknown>>()
        return {
          getOne: vi.fn(async <T = unknown>(id: string): Promise<T> => {
            const record = col.get(id)
            if (!record) throw new Error('Not found')
            return record as unknown as T
          }),
          getFirstListItem: vi.fn(async <T = unknown>(filter: string): Promise<T> => {
            const key = filter.match(/key\s*=\s*"([^"]+)"/)?.[1]
            if (key) {
              const record = col.get(key)
              if (record) return { id: String(++idCounter), ...record } as unknown as T
            }
            throw new Error('Not found')
          }),
          getFullList: vi.fn(async <T = unknown>(): Promise<T[]> => Array.from(col.values()) as unknown as T[]),
          getList: vi.fn(async <T = unknown>(): Promise<{ items: T[]; totalItems: number }> => {
            const items = Array.from(col.values())
            return { items: items as unknown as T[], totalItems: items.length }
          }),
          create: vi.fn(async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
            if (name === 'app_secrets') {
              const key = data.key as string
              appSecrets.set(key, {
                value: data.value as string,
                created_at: data.created_at as number,
                updated_at: data.updated_at as number,
              })
            }
            return { id: String(++idCounter), ...data } as unknown as T
          }),
          update: vi.fn(async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
            return { id, ...data } as unknown as T
          }),
          delete: vi.fn(async (id: string): Promise<boolean> => {
            for (const [key, val] of appSecrets) {
              if ((val as Record<string, unknown>).key === id || key === id) {
                appSecrets.delete(key)
              }
            }
            return true
          }),
        }
      },
      health: { check: vi.fn(async () => ({ code: 200 })) },
    } as unknown as PocketBase

    const mockGitAuthService = {} as GitAuthService
    const mockOpenCodeClient = {} as OpenCodeClient
    const routes = createSettingsRoutes(pb, mockGitAuthService, mockOpenCodeClient)
    app = new Hono().route('/api/settings', routes)
  })

  afterEach(() => {
    setEnvPassword(originalPassword)
  })

  describe('GET /api/settings/opencode-server-auth', () => {
    it('returns source none when no password is configured', async () => {
      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: false, source: 'none' })
    })

    it('returns source env when only env password is configured', async () => {
      setEnvPassword('envpassword123')

      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'env' })
    })

    it('returns source db when stored password exists', async () => {
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'db' })
    })

    it('returns source db when both stored and env passwords exist', async () => {
      setEnvPassword('envpassword123')
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'db' })
    })
  })

  describe('PATCH /api/settings/opencode-server-auth', () => {
    it('stores password encrypted, restarts server, and returns db source', async () => {
      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'testpassword123' }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'db' })
      expect(mockRestart).toHaveBeenCalledOnce()

      const row = await pb.collection('app_secrets').getFirstListItem('key = "opencode_server_password"') as { value: string }
      expect(row).toBeDefined()
      expect(row.value).not.toBe('testpassword123')
    })

    it('clears stored password and returns none source without env fallback', async () => {
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: false, source: 'none' })
      expect(mockRestart).toHaveBeenCalledOnce()

      const exists = await pb.collection('app_secrets').getFirstListItem('key = "opencode_server_password"').catch(() => null)
      expect(exists).toBeNull()
    })

    it('clears stored password and returns env source when env fallback exists', async () => {
      setEnvPassword('envpassword123')
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'env' })
      expect(mockRestart).toHaveBeenCalledOnce()
    })

    it('returns 400 when password is shorter than 8 characters', async () => {
      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'short' }),
      })

      expect(response.status).toBe(400)
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('restores missing stored password when restart fails after storing a new password', async () => {
      setEnvPassword('envpassword123')
      mockRestart.mockRejectedValueOnce(new Error('restart failed'))

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'testpassword123' }),
      })

      expect(response.status).toBe(500)
      expect(mockRestart).toHaveBeenCalledTimes(2)

      const exists = await pb.collection('app_secrets').getFirstListItem('key = "opencode_server_password"').catch(() => null)
      expect(exists).toBeNull()

      const statusResponse = await app.request('/api/settings/opencode-server-auth')
      expect(await statusResponse.json()).toEqual({ isSet: true, source: 'env' })
    })

    it('restores previous stored password when restart fails after clearing it', async () => {
      insertPassword('testpassword123')
      const previous = await pb.collection('app_secrets').getFirstListItem('key = "opencode_server_password"') as { value: string }
      mockRestart.mockRejectedValueOnce(new Error('restart failed'))

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(500)
      expect(mockRestart).toHaveBeenCalledTimes(2)

      const restored = await pb.collection('app_secrets').getFirstListItem('key = "opencode_server_password"').catch(() => null) as { value: string } | null
      expect(restored?.value).toBe(previous.value)
    })
  })

  function insertPassword(password: string) {
    const encrypted = encryptSecret(password)
    const now = Date.now()
    appSecrets.set('opencode_server_password', {
      value: encrypted,
      created_at: now,
      updated_at: now,
    })
  }

  function setEnvPassword(password: string) {
    Object.defineProperty(ENV.OPENCODE, 'SERVER_PASSWORD', {
      value: password,
      configurable: true,
      writable: true,
    })
  }
})
