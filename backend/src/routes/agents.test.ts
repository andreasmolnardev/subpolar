import { describe, expect, it } from 'vitest'
import { createAgentRoutes } from './agents'

function createDatabase() {
  const records = new Map<string, Record<string, unknown>>()
  let nextId = 0

  const collection = () => ({
    getFullList: async () => [...records.values()],
    getOne: async (id: string) => {
      const record = records.get(id)
      if (!record) throw new Error('Not found')
      return record
    },
    getFirstListItem: async (filter: string) => {
      const name = filter.match(/^name = "(.*)"$/)?.[1]
      const record = [...records.values()].find(item => item.name === name)
      if (!record) throw new Error('Not found')
      return record
    },
    create: async (data: Record<string, unknown>) => {
      const record = { id: `agent-${++nextId}`, ...data }
      records.set(String(record.id), record)
      return record
    },
    update: async (id: string, data: Record<string, unknown>) => {
      const existing = records.get(id)
      if (!existing) throw new Error('Not found')
      const record = { ...existing, ...data }
      records.set(id, record)
      return record
    },
    delete: async (id: string) => records.delete(id),
  })

  return { collection } as never
}

describe('agent routes', () => {
  it('persists a newly created user agent', async () => {
    const app = createAgentRoutes(createDatabase())

    const createResponse = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'researcher',
        description: 'Researches topics',
        mode: 'primary',
        prompt: 'Research the requested topic.',
        permission: { webfetch: 'allow' },
        skills: ['research'],
        skillAccess: [{ id: 'tool-openai-responses-create', discovery: 'name', source: 'tool-default' }],
      }),
    })

    expect(createResponse.status).toBe(200)
    await expect(createResponse.json()).resolves.toMatchObject({
      id: 'agent-1',
      name: 'researcher',
      source: 'user',
      enabled: true,
      skillAccess: [{ id: 'tool-openai-responses-create', discovery: 'name', source: 'tool-default' }],
    })

    const listResponse = await app.request('/')

    await expect(listResponse.json()).resolves.toMatchObject([
      { id: 'agent-1', name: 'researcher', prompt: 'Research the requested topic.' },
    ])
  })
})
