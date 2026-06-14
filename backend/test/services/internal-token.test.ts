import { describe, it, expect } from 'vitest'
import { getOrCreateInternalToken, rotateInternalToken } from '../../src/services/internal-token'
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
      update: async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
        const key = data.key as string | undefined
        if (key) {
          const existing = secrets.get(key)
          if (existing) {
            secrets.set(key, { ...existing, ...data } as { value: string; created_at: number; updated_at: number })
          }
        } else {
          for (const [k, v] of secrets) {
            if (v.value) {
              secrets.set(k, { ...v, ...data } as { value: string; created_at: number; updated_at: number })
              break
            }
          }
        }
        return { id, ...data } as unknown as T
      },
      getOne: async <T = unknown>(id: string): Promise<T> => {
        throw new Error('Not found')
      },
      getFullList: async <T = unknown>(): Promise<T[]> => [],
      getList: async <T = unknown>(): Promise<{ items: T[]; totalItems: number }> => ({ items: [], totalItems: 0 }),
      delete: async (): Promise<boolean> => true,
    }),
    health: { check: async () => ({ code: 200 }) },
  } as unknown as PocketBase
}

describe('internal-token', () => {
  it('getOrCreateInternalToken creates a token on first call and returns it', async () => {
    const pb = createMockPocketBase()
    const token = await getOrCreateInternalToken(pb)
    expect(token).toBeDefined()
    expect(token.length).toBe(64)
    expect(/^[0-9a-f]+$/.test(token)).toBe(true)
  })

  it('getOrCreateInternalToken returns the same token on subsequent calls', async () => {
    const pb = createMockPocketBase()
    const token1 = await getOrCreateInternalToken(pb)
    const token2 = await getOrCreateInternalToken(pb)
    expect(token1).toBe(token2)
  })

  it('rotateInternalToken replaces the value', async () => {
    const pb = createMockPocketBase()
    const token1 = await getOrCreateInternalToken(pb)
    const token2 = await rotateInternalToken(pb)
    expect(token1).not.toBe(token2)
    const token3 = await getOrCreateInternalToken(pb)
    expect(token3).toBe(token2)
  })
})
