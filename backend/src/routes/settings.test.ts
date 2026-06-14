import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type PocketBase from 'pocketbase'
import { createSettingsRoutes } from './settings'
import type { GitAuthService } from '../services/git-auth'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'

function createMockPocketBase(): PocketBase {
  const prefs = new Map<string, { preferences: string; updated_at: number }>()
  let idCounter = 0

  return {
    collection: (name: string) => ({
      getFirstListItem: async <T = unknown>(filter: string): Promise<T> => {
        const userId = filter.match(/user_id\s*=\s*"([^"]+)"/)?.[1]
        if (userId) {
          const record = prefs.get(userId)
          if (record) return { id: String(++idCounter), user_id: userId, ...record } as unknown as T
        }
        throw new Error('Not found')
      },
      create: async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
        const userId = data.user_id as string
        prefs.set(userId, {
          preferences: data.preferences as string,
          updated_at: data.updated_at as number,
        })
        return { id: String(++idCounter), ...data } as unknown as T
      },
      update: async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
        return { id, ...data } as unknown as T
      },
      getOne: async <T = unknown>(): Promise<T> => { throw new Error('Not found') },
      getFullList: async <T = unknown>(): Promise<T[]> => [],
      getList: async <T = unknown>(): Promise<{ items: T[]; totalItems: number }> => ({ items: [], totalItems: 0 }),
      delete: async (): Promise<boolean> => true,
    }),
    health: { check: async () => ({ code: 200 }) },
  } as unknown as PocketBase
}

const mockGitAuthService = {
  getGitEnvironment: () => ({}),
} as unknown as GitAuthService

function createTestApp(pb: PocketBase): Hono {
  const app = new Hono()
  app.route('/settings', createSettingsRoutes(pb, mockGitAuthService, createStubOpenCodeClient()))
  return app
}

describe('settings routes — serverEnvVars', () => {
  let pb: PocketBase
  let app: Hono
  let originalWorkspacePath: string | undefined

  beforeEach(() => {
    pb = createMockPocketBase()
    app = createTestApp(pb)
    originalWorkspacePath = process.env.WORKSPACE_PATH
    process.env.WORKSPACE_PATH = '/tmp/test-workspace-settings-routes'
  })

  afterEach(() => {
    if (originalWorkspacePath) {
      process.env.WORKSPACE_PATH = originalWorkspacePath
    } else {
      delete process.env.WORKSPACE_PATH
    }
  })

  it('GET / returns empty serverEnvVars by default', async () => {
    const res = await app.request('/settings')

    expect(res.status).toBe(200)
    const data = (await res.json()) as { preferences: { serverEnvVars?: Array<{ key: string; value: string }> } }
    expect(data.preferences.serverEnvVars).toEqual([])
  })

  it('PATCH / saves and returns serverEnvVars', async () => {
    const patchRes = await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          serverEnvVars: [
            {
              key: 'OPENCODE_EXPERIMENTAL_WORKSPACES',
              value: 'true',
            },
          ],
        },
      }),
    })

    expect(patchRes.status).toBe(200)
    const data = (await patchRes.json()) as { preferences: { serverEnvVars: Array<{ key: string; value: string }> } }
    expect(data.preferences.serverEnvVars).toEqual([
      {
        key: 'OPENCODE_EXPERIMENTAL_WORKSPACES',
        value: 'true',
      },
    ])
  })

  it('PATCH / persists serverEnvVars and returns on GET', async () => {
    await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          serverEnvVars: [{
            key: 'MY_FLAG',
            value: '1',
          }],
        },
      }),
    })

    const res = await app.request('/settings')
    const data = (await res.json()) as { preferences: { serverEnvVars: Array<{ key: string; value: string }> } }

    expect(data.preferences.serverEnvVars).toEqual([
      {
        key: 'MY_FLAG',
        value: '1',
      },
    ])
  })
})
