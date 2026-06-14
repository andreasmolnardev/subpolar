import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createProvidersRoutes } from './providers'
import { join, dirname } from 'node:path'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import type PocketBase from 'pocketbase'

function createMockPocketBase(): PocketBase {
  const collections = new Map<string, Map<string, Record<string, unknown>>>()
  let idCounter = 0

  function getCollection(name: string) {
    if (!collections.has(name)) {
      collections.set(name, new Map())
    }
    return collections.get(name)!
  }

  function nextId(): string {
    idCounter++
    return `mock-${idCounter}`
  }

  function parseFilterUserId(filter: string): string {
    const match = filter.match(/user_id\s*=\s*"([^"]+)"/)
    return match?.[1] ?? 'default'
  }

  return {
    collection: (name: string) => ({
      getFirstListItem: async <T = unknown>(filter: string): Promise<T> => {
        const col = getCollection(name)
        const userId = parseFilterUserId(filter)
        for (const record of col.values()) {
          if ((record as Record<string, unknown>).user_id === userId) {
            return record as unknown as T
          }
        }
        throw new Error('Not found')
      },
      create: async <T = unknown>(bodyParams?: Record<string, unknown>): Promise<T> => {
        const col = getCollection(name)
        const id = nextId()
        const record = { ...bodyParams, id, collectionId: name, collectionName: name }
        col.set(id, record as Record<string, unknown>)
        return record as unknown as T
      },
      update: async <T = unknown>(id: string, bodyParams?: Record<string, unknown>): Promise<T> => {
        const col = getCollection(name)
        const existing = col.get(id)
        if (!existing) throw new Error('Not found')
        const updated = { ...existing, ...bodyParams }
        col.set(id, updated)
        return updated as unknown as T
      },
    }),
  } as unknown as PocketBase
}

function createTestApp(pb: PocketBase): Hono {
  const app = new Hono()
  app.route('/providers', createProvidersRoutes(pb, createStubOpenCodeClient()))
  return app
}

describe('providers routes', () => {
  let pb: PocketBase
  let app: Hono
  let tmpDir: string
  let originalWorkspacePath: string | undefined

  beforeEach(async () => {
    pb = createMockPocketBase()
    app = createTestApp(pb)
    tmpDir = await mkdtemp(join(tmpdir(), 'providers-test-'))
    originalWorkspacePath = process.env.WORKSPACE_PATH
    process.env.WORKSPACE_PATH = tmpDir
    
    const { getModelStatePath } = await import('./providers')
    const modelStatePath = getModelStatePath()
    const modelStateDir = dirname(modelStatePath)
    await mkdir(modelStateDir, { recursive: true })
  })

  afterEach(async () => {
    if (originalWorkspacePath) {
      process.env.WORKSPACE_PATH = originalWorkspacePath
    } else {
      delete process.env.WORKSPACE_PATH
    }
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('GET /model-state', () => {
    it('on empty DB returns defaults', async () => {
      const res = await app.request('/providers/model-state')
      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: unknown[]; favorite: unknown[]; variant: Record<string, unknown> }
      expect(data).toEqual({ recent: [], favorite: [], variant: {} })
    })
  })

  describe('POST /model-state', () => {
    it('with recent returns 200 with recent[0] set', async () => {
      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recent: { providerID: 'anthropic', modelID: 'claude' } }),
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: Array<{ providerID: string; modelID: string }> }
      expect(data.recent).toHaveLength(1)
      expect(data.recent[0]).toEqual({ providerID: 'anthropic', modelID: 'claude' })
    })

    it('with favorite toggles favorite (add then remove)', async () => {
      const body = { favorite: { providerID: 'openai', modelID: 'gpt-4' } }
      
      const res1 = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res1.status).toBe(200)
      const data1 = (await res1.json()) as { favorite: Array<{ providerID: string; modelID: string }> }
      expect(data1.favorite).toHaveLength(1)

      const res2 = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res2.status).toBe(200)
      const data2 = (await res2.json()) as { favorite: Array<{ providerID: string; modelID: string }> }
      expect(data2.favorite).toHaveLength(0)
    })

    it('with invalid body returns 400', async () => {
      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      })
      expect(res.status).toBe(400)
      const data = (await res.json()) as { error: string }
      expect(data.error).toBe('Invalid request data')
    })

    it('with corrupt model.json on disk still returns 200 and overwrites with valid JSON', async () => {
      const { getModelStatePath } = await import('./providers')
      const modelStatePath = getModelStatePath()
      await writeFile(modelStatePath, '{ invalid json content }', 'utf8')

      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recent: { providerID: 'test', modelID: 'test' } }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: Array<{ providerID: string; modelID: string }> }
      expect(data.recent).toHaveLength(1)

      const fileContent = await Bun.file(modelStatePath).text()
      const parsed = JSON.parse(fileContent) as { recent: unknown[] }
      expect(parsed.recent).toHaveLength(1)
    })

    it('20 concurrent POST calls all return 200, final recent is valid and bounded', async () => {
      const numOps = 20

      const requests = Array.from({ length: numOps }, (_, i) =>
        app.request('/providers/model-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recent: { providerID: `provider-${i}`, modelID: `model-${i}` } }),
        }),
      )

      const responses = await Promise.all(requests)
      responses.forEach((res) => {
        expect(res.status).toBe(200)
      })

      const finalRes = await app.request('/providers/model-state')
      const finalData = (await finalRes.json()) as { recent: Array<{ providerID: string; modelID: string }> }
      expect(finalData.recent.length).toBeLessThanOrEqual(10)
      expect(finalData.recent.length).toBeGreaterThan(0)

      const uniqueKeys = new Set(finalData.recent.map((m) => `${m.providerID}/${m.modelID}`))
      expect(uniqueKeys.size).toBe(finalData.recent.length)
    })
  })
})
