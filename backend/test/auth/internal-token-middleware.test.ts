import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createInternalTokenMiddleware } from '../../src/auth/internal-token-middleware'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import type PocketBase from 'pocketbase'

function createMockPocketBase(): PocketBase {
  const secrets = new Map<string, { value: string; created_at: number; updated_at: number }>()
  let idCounter = 0

  return {
    collection: (name: string) => ({
      getFirstListItem: async <T = unknown>(filter: string): Promise<T> => {
        const key = filter.match(/key\s*=\s*"([^"]+)"/)?.[1]
        if (key) {
          const record = secrets.get(key)
          if (record) return { id: String(++idCounter), ...record } as unknown as T
        }
        throw new Error('Not found')
      },
      create: async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
        const key = data.key as string
        secrets.set(key, {
          value: data.value as string,
          created_at: data.created_at as number,
          updated_at: data.updated_at as number,
        })
        return { id: String(++idCounter), ...data } as unknown as T
      },
      update: async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => ({ id, ...data } as unknown as T),
      getOne: async <T = unknown>(): Promise<T> => { throw new Error('Not found') },
      getFullList: async <T = unknown>(): Promise<T[]> => [],
      getList: async <T = unknown>(): Promise<{ items: T[]; totalItems: number }> => ({ items: [], totalItems: 0 }),
      delete: async (): Promise<boolean> => true,
    }),
    health: { check: async () => ({ code: 200 }) },
  } as unknown as PocketBase
}

function createTestApp(pb: PocketBase) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(pb))
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

describe('internal-token-middleware', () => {
  it('returns 401 when authorization header is missing', async () => {
    const pb = createMockPocketBase()
    const app = createTestApp(pb)
    const res = await app.request('/test')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when authorization header is not bearer or basic scheme', async () => {
    const pb = createMockPocketBase()
    const app = createTestApp(pb)
    const res = await app.request('/test', {
      headers: { authorization: 'Digest abc123' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token is wrong', async () => {
    const pb = createMockPocketBase()
    const validToken = await getOrCreateInternalToken(pb)
    const app = createTestApp(pb)
    const res = await app.request('/test', {
      headers: { authorization: `Bearer ${validToken}wrong` },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token has different length', async () => {
    const pb = createMockPocketBase()
    const app = createTestApp(pb)
    const res = await app.request('/test', {
      headers: { authorization: 'Bearer short' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 when bearer token matches', async () => {
    const pb = createMockPocketBase()
    const token = await getOrCreateInternalToken(pb)
    const app = createTestApp(pb)
    const res = await app.request('/test', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('returns 401 when basic auth password is wrong', async () => {
    const pb = createMockPocketBase()
    const app = createTestApp(pb)
    const res = await app.request('/test', {
      headers: { authorization: 'Basic ' + Buffer.from('opencode:wrong-password').toString('base64') },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 when basic auth password matches internal token', async () => {
    const pb = createMockPocketBase()
    const token = await getOrCreateInternalToken(pb)
    const app = createTestApp(pb)
    const res = await app.request('/test', {
      headers: { authorization: 'Basic ' + Buffer.from(`opencode:${token}`).toString('base64') },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })
})
