import { describe, expect, it } from 'vitest'
import type PocketBase from 'pocketbase'
import { AuthService } from '../../src/services/auth'

function createMockDatabase(): PocketBase {
  const records = new Map<string, Record<string, unknown>>()
  let nextId = 0

  return {
    collection: () => ({
      getFullList: async () => Array.from(records.values()),
      create: async (data: Record<string, unknown>) => {
        const id = `login-${++nextId}`
        const record = { ...data, id }
        records.set(id, record)
        return record
      },
      update: async (id: string, data: Record<string, unknown>) => {
        const record = { ...records.get(id), ...data, id }
        records.set(id, record)
        return record
      },
      delete: async (id: string) => {
        records.delete(id)
      },
    }),
  } as unknown as PocketBase
}

describe('AuthService', () => {
  it('stores, updates, and deletes provider credentials in the database', async () => {
    const service = new AuthService(createMockDatabase())

    await service.set('openai', 'first-key')
    await service.set('openai', 'updated-key')

    expect(await service.getAll()).toEqual({ openai: { type: 'api_key', key: 'updated-key' } })
    expect(await service.list()).toEqual(['openai'])
    expect(await service.has('openai')).toBe(true)

    await service.delete('openai')

    expect(await service.getAll()).toEqual({})
    expect(await service.has('openai')).toBe(false)
  })

  it('provides Pi with an in-memory copy of database credentials', async () => {
    const service = new AuthService(createMockDatabase())
    await service.set('anthropic', 'database-key')

    const storage = await service.createStorage()

    expect(storage.get('anthropic')).toEqual({ type: 'api_key', key: 'database-key' })
  })
})
