import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../src/db/schema'
import { callTool } from '../../src/services/subpolar-tool-router'
import { resolveCalDavDateRange } from '../../src/services/caldav'

const getEvents = vi.fn()
const getCalendars = vi.fn()
const originalFetch = globalThis.fetch

vi.mock('ts-caldav', () => ({
  CalDAVClient: {
    create: vi.fn(async () => ({
      getCalendars,
      getEvents,
    })),
  },
}))

function createDb(): Database {
  const now = Date.now()
  const records: Record<string, Array<Record<string, unknown>>> = {
    agents: [{
      id: 'productivity',
      name: 'productivity',
      description: 'Productivity',
      mode: 'subagent',
      prompt: '',
      permission: {},
      skills: [],
      enabled: true,
      source: 'system',
      sort_order: 0,
      created_at: now,
      updated_at: now,
    }],
    tool_registry: [{
      id: 'tool-1',
      tool_id: 'calendar.get',
      namespace: 'calendar',
      description: 'Read events',
      adapter: 'internal',
      target: 'caldav',
      operation: 'get_events',
      input_schema: { type: 'object', properties: {} },
      output_schema: {},
      risk: 'read',
      requires_approval: false,
      enabled: true,
      metadata: { integrationType: 'caldav' },
      created_at: now,
      updated_at: now,
    }],
    agent_tool_policies: [{ id: 'policy-1', agent_id: 'productivity', tool_id: 'calendar.get', effect: 'allow' }],
    integrations: [{
      id: 'integration-1',
      name: 'Personal',
      type: 'caldav',
      enabled: true,
      config: {
        serverUrl: 'https://calendar.example.com',
        username: 'andrew',
        password: 'secret',
        calendarUrl: '/calendars/andrew/personal/',
      },
      metadata: {},
      created_at: now,
      updated_at: now,
    }],
    tool_call_audit: [],
  }

  return {
    collection: (name: string) => ({
      getOne: async (id: string) => {
        const record = (records[name] ?? []).find(item => item.id === id)
        if (!record) throw new Error('not found')
        return record
      },
      getFirstListItem: async (filter: string) => {
        const items = records[name] ?? []
        const record = items.find((item) => {
          if (name === 'tool_registry') return filter.includes(`"${String(item.tool_id)}"`) && item.enabled !== false
          if (name === 'agents') return filter.includes(`"${String(item.name)}"`)
          if (name === 'integrations') return item.enabled !== false && filter.includes(`type = "${String(item.type)}"`)
          return false
        })
        if (!record) throw new Error('not found')
        return record
      },
      getFullList: async () => records[name] ?? [],
      create: async (data: Record<string, unknown>) => {
        const record = { id: `${name}-${records[name]?.length ?? 0}`, ...data }
        records[name] = [...(records[name] ?? []), record]
        return record
      },
    }),
  } as unknown as Database
}

function createResearchDb(): Database {
  const now = Date.now()
  const records: Record<string, Array<Record<string, unknown>>> = {
    agents: [{
      id: 'research',
      name: 'research',
      description: 'Research',
      mode: 'subagent',
      prompt: '',
      permission: {},
      skills: [],
      enabled: true,
      source: 'system',
      sort_order: 0,
      created_at: now,
      updated_at: now,
    }],
    tool_registry: [
      {
        id: 'tool-search',
        tool_id: 'web.search',
        namespace: 'web',
        description: 'Search',
        adapter: 'internal',
        target: 'web',
        operation: 'search',
        input_schema: { type: 'object', properties: {}, required: ['query'] },
        output_schema: {},
        risk: 'external',
        requires_approval: false,
        enabled: true,
        metadata: {},
        created_at: now,
        updated_at: now,
      },
      {
        id: 'tool-scrape',
        tool_id: 'web.scrape',
        namespace: 'web',
        description: 'Scrape',
        adapter: 'internal',
        target: 'web',
        operation: 'scrape',
        input_schema: { type: 'object', properties: {}, required: ['url'] },
        output_schema: {},
        risk: 'external',
        requires_approval: false,
        enabled: true,
        metadata: {},
        created_at: now,
        updated_at: now,
      },
    ],
    agent_tool_policies: [
      { id: 'policy-search', agent_id: 'research', tool_id: 'web.search', effect: 'allow' },
      { id: 'policy-scrape', agent_id: 'research', tool_id: 'web.scrape', effect: 'allow' },
    ],
    integrations: [],
    tool_call_audit: [],
  }

  return {
    collection: (name: string) => ({
      getOne: async (id: string) => {
        const record = (records[name] ?? []).find(item => item.id === id)
        if (!record) throw new Error('not found')
        return record
      },
      getFirstListItem: async (filter: string) => {
        const items = records[name] ?? []
        const record = items.find((item) => {
          if (name === 'tool_registry') return filter.includes(`"${String(item.tool_id)}"`) && item.enabled !== false
          if (name === 'agents') return filter.includes(`"${String(item.name)}"`)
          return false
        })
        if (!record) throw new Error('not found')
        return record
      },
      getFullList: async () => records[name] ?? [],
      create: async (data: Record<string, unknown>) => {
        const record = { id: `${name}-${records[name]?.length ?? 0}`, ...data }
        records[name] = [...(records[name] ?? []), record]
        return record
      },
    }),
  } as unknown as Database
}

describe('subpolar tool router', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch
    getCalendars.mockReset()
    getEvents.mockReset()
    getEvents.mockResolvedValue([{
      summary: 'Planning',
      start: new Date('2026-07-06T09:00:00.000Z'),
      end: new Date('2026-07-06T10:00:00.000Z'),
      location: 'Office',
    }])
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('resolves next week to the next calendar week', () => {
    const range = resolveCalDavDateRange({ range: 'next week' }, new Date('2026-06-28T12:00:00.000Z'))
    expect([range.start.getFullYear(), range.start.getMonth(), range.start.getDate(), range.start.getHours()]).toEqual([2026, 5, 29, 0])
    expect([range.end.getFullYear(), range.end.getMonth(), range.end.getDate(), range.end.getHours()]).toEqual([2026, 6, 6, 0])
  })

  it('returns CalDAV events for calendar.get', async () => {
    await expect(callTool(createDb(), 'productivity', 'calendar.get', {
      start: '2026-07-06T00:00:00.000Z',
      end: '2026-07-13T00:00:00.000Z',
    })).resolves.toMatchObject({
      ok: true,
      toolId: 'calendar.get',
      result: {
        calendars: [{
          id: 'integration-1:https://calendar.example.com/calendars/andrew/personal/',
          name: 'Personal',
          url: 'https://calendar.example.com/calendars/andrew/personal/',
        }],
        events: [{
          title: 'Planning',
          calendar: 'Personal',
          start: '2026-07-06T09:00:00.000Z',
          end: '2026-07-06T10:00:00.000Z',
          location: 'Office',
        }],
      },
    })
    expect(getEvents).toHaveBeenCalledWith('https://calendar.example.com/calendars/andrew/personal/', {
      start: new Date('2026-07-06T00:00:00.000Z'),
      end: new Date('2026-07-13T00:00:00.000Z'),
    })
  })

  it('searches the web for web.search', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{
          type: 'text',
          text: '[Example & Docs](https://example.com/docs)\nUseful documentation snippet.',
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    await expect(callTool(createResearchDb(), 'research', 'web.search', {
      query: 'example docs',
      limit: 3,
    })).resolves.toMatchObject({
      ok: true,
      toolId: 'web.search',
      result: {
        query: 'example docs',
        results: [{
          title: 'Example & Docs',
          url: 'https://example.com/docs',
          snippet: 'Useful documentation snippet.',
        }],
        context: '[Example & Docs](https://example.com/docs)\nUseful documentation snippet.',
        provider: 'exa',
      },
    })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://mcp.exa.ai/mcp', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'web_search_exa',
          arguments: {
            query: 'example docs',
            type: 'auto',
            numResults: 3,
            livecrawl: 'fallback',
            contextMaxCharacters: 10000,
          },
        },
      }),
    }))
  })

  it('scrapes readable page text for web.scrape', async () => {
    globalThis.fetch = vi.fn(async () => new Response(`
      <html>
        <head><title>Example Page</title><style>.hidden{}</style></head>
        <body><script>ignored()</script><h1>Heading</h1><p>Useful content.</p></body>
      </html>
    `, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch

    await expect(callTool(createResearchDb(), 'research', 'web.scrape', {
      url: 'https://example.com/page',
      maxLength: 1000,
    })).resolves.toMatchObject({
      ok: true,
      toolId: 'web.scrape',
      result: {
        url: 'https://example.com/page',
        title: 'Example Page',
        content: expect.stringContaining('Useful content.'),
        truncated: false,
      },
    })
  })
})
