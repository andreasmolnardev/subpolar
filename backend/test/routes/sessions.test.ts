import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type PocketBase from 'pocketbase'
import { createSessionRoutes } from '../../src/routes/sessions'
import type { RuntimeAdapter, RuntimeEvent, RuntimeRunInput } from '../../src/runtime/types'
import type { RuntimeRegistry } from '../../src/runtime/registry'

function createMockPocketBase(): PocketBase {
  type RecordRow = Record<string, unknown> & { id: string }
  const collections = new Map<string, RecordRow[]>()
  const idCounters = new Map<string, number>()

  function nextId(name: string): string {
    const current = idCounters.get(name) ?? 0
    const next = current + 1
    idCounters.set(name, next)
    return `${name}-${next}`
  }

  function getCollection(name: string): RecordRow[] {
    const collection = collections.get(name)
    if (collection) return collection
    const nextCollection: RecordRow[] = []
    collections.set(name, nextCollection)
    return nextCollection
  }

  function matchFilter(record: RecordRow, filter?: string): boolean {
    if (!filter) return true
    const sessionMatch = filter.match(/session_id\s*=\s*"([^"]+)"/)
    if (sessionMatch && String(record.session_id ?? '') !== sessionMatch[1]) return false
    const runMatch = filter.match(/run_id\s*=\s*"([^"]+)"/)
    if (runMatch && String(record.run_id ?? '') !== runMatch[1]) return false
    return true
  }

  return {
    collection: (name: string) => ({
      create: async (data: Record<string, unknown>) => {
        const record = { id: nextId(name), ...data } as RecordRow
        getCollection(name).push(record)
        return record
      },
      update: async (id: string, data: Record<string, unknown>) => {
        const collection = getCollection(name)
        const record = collection.find((item) => item.id === id)
        if (!record) throw new Error(`Missing record ${name}:${id}`)
        Object.assign(record, data)
        return record
      },
      delete: async (id: string) => {
        const collection = getCollection(name)
        const index = collection.findIndex((item) => item.id === id)
        if (index >= 0) collection.splice(index, 1)
        return true
      },
      getFirstListItem: async (filter: string) => {
        const record = getCollection(name).find((item) => matchFilter(item, filter))
        if (!record) {
          const error = new Error('Not found') as Error & { status?: number }
          error.status = 404
          throw error
        }
        return record
      },
      getFullList: async (options?: { filter?: string }) => getCollection(name).filter((item) => matchFilter(item, options?.filter)),
    }),
  } as unknown as PocketBase
}

function createMockRuntimeRegistry(capturedPrompts: string[]): RuntimeRegistry {
  const adapter: RuntimeAdapter = {
    id: 'pi',
    run: async function * (input: RuntimeRunInput): AsyncIterable<RuntimeEvent> {
      const prompt = input.messages[0]?.content ?? ''
      if (input.agentId === 'session-naming') {
        capturedPrompts.push(prompt)
        yield { type: 'message.delta', content: '**My Session**' }
        yield { type: 'run.completed' }
        return
      }

      yield { type: 'run.completed' }
    },
    cancel: async () => {},
  }

  return {
    get: () => adapter,
    register: () => {},
    list: () => ['pi'],
  } as unknown as RuntimeRegistry
}

describe('session title generation', () => {
  it('asks the naming agent for plain text and strips markdown from the result', async () => {
    const db = createMockPocketBase()
    const capturedPrompts: string[] = []
    const runtimeRegistry = createMockRuntimeRegistry(capturedPrompts)
    const app = new Hono()
    app.route('/sessions', createSessionRoutes(db, runtimeRegistry))

    const sessionId = 'session-1'
    await db.collection('sessions').create({
      session_id: sessionId,
      title: null,
      directory: null,
      project_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    })

    await db.collection('messages').create({
      session_id: sessionId,
      role: 'user',
      content: 'Please review the deployment checklist',
      created_at: Date.now(),
    })

    const response = await app.request(`/sessions/${sessionId}/runs`, {
      method: 'POST',
      body: JSON.stringify({ agentId: 'default' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(201)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(capturedPrompts[0]).toContain('plain-text title')
    expect(capturedPrompts[0]).toContain('Do not use markdown formatting')

    const session = await db.collection('sessions').getFirstListItem(`session_id = "${sessionId}"`)
    expect(session.title).toBe('My Session')
  })
})
