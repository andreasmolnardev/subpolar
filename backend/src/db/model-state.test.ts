import { describe, it, expect, beforeEach } from 'vitest'
import type PocketBase from 'pocketbase'
import {
  getOpenCodeModelState,
  addRecentOpenCodeModel,
  toggleFavoriteOpenCodeModel,
  setOpenCodeVariant,
  MAX_RECENT_MODELS,
} from './model-state'

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

describe('model-state', () => {
  let pb: PocketBase

  beforeEach(() => {
    pb = createMockPocketBase()
  })

  describe('getOpenCodeModelState', () => {
    it('returns empty defaults when no row exists', async () => {
      const state = await getOpenCodeModelState(pb)
      expect(state).toEqual({ recent: [], favorite: [], variant: {} })
    })

    it('returns defaults with explicit userId when no row exists', async () => {
      const state = await getOpenCodeModelState(pb, 'user123')
      expect(state).toEqual({ recent: [], favorite: [], variant: {} })
    })
  })

  describe('addRecentOpenCodeModel', () => {
    it('inserts new state and returns the model in recent[0]', async () => {
      const model = { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' }
      const state = await addRecentOpenCodeModel(pb, model)
      expect(state.recent).toHaveLength(1)
      expect(state.recent[0]).toEqual(model)
    })

    it('deduplicates re-selections (same model added twice → length 1, model at index 0)', async () => {
      const model = { providerID: 'openai', modelID: 'gpt-4o' }
      await addRecentOpenCodeModel(pb, model)
      const state = await addRecentOpenCodeModel(pb, model)
      expect(state.recent).toHaveLength(1)
      expect(state.recent[0]).toEqual(model)
    })

    it('caps at MAX_RECENT_MODELS (insert 12 distinct, expect 10)', async () => {
      for (let i = 0; i < 12; i++) {
        await addRecentOpenCodeModel(pb, { providerID: `provider-${i}`, modelID: `model-${i}` })
      }
      const state = await getOpenCodeModelState(pb)
      expect(state.recent).toHaveLength(MAX_RECENT_MODELS)
      expect(state.recent[0]).toEqual({ providerID: 'provider-11', modelID: 'model-11' })
    })
  })

  describe('toggleFavoriteOpenCodeModel', () => {
    it('adds when missing', async () => {
      const model = { providerID: 'anthropic', modelID: 'claude' }
      const state = await toggleFavoriteOpenCodeModel(pb, model)
      expect(state.favorite).toHaveLength(1)
      expect(state.favorite[0]).toEqual(model)
    })

    it('removes when present', async () => {
      const model = { providerID: 'openai', modelID: 'gpt-4' }
      await toggleFavoriteOpenCodeModel(pb, model)
      const state = await toggleFavoriteOpenCodeModel(pb, model)
      expect(state.favorite).toHaveLength(0)
    })
  })

  describe('setOpenCodeVariant', () => {
    it('adds variant entry', async () => {
      const state = await setOpenCodeVariant(pb, 'key1', 'variant1')
      expect(state.variant.key1).toBe('variant1')
    })

    it('updates variant entry', async () => {
      await setOpenCodeVariant(pb, 'key1', 'variant1')
      const state = await setOpenCodeVariant(pb, 'key1', 'variant2')
      expect(state.variant.key1).toBe('variant2')
    })

    it('deletes variant when undefined', async () => {
      await setOpenCodeVariant(pb, 'key1', 'variant1')
      const state = await setOpenCodeVariant(pb, 'key1', undefined)
      expect(state.variant.key1).toBeUndefined()
    })
  })
})
