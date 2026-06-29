import { describe, expect, it } from 'vitest'
import { authorizePiToolCall, mapPiToolName } from '../../src/pi/tool-policy'
import type { Database } from '../../src/db/schema'

function createDb(permissionOverride?: string): Database {
  const records: Record<string, Array<Record<string, unknown>>> = {
    runs: [{
      id: 'run-record-1',
      run_id: 'run-1',
      session_id: 'session-1',
      agent_id: 'agent-1',
      runtime: 'pi',
      status: 'running',
      error: '',
      metadata: permissionOverride ? { permissionOverride } : {},
      created_at: Date.now(),
      updated_at: Date.now(),
    }],
    agents: [{ id: 'agent-1', name: 'Agent', enabled: true }],
    tool_registry: [{
      id: 'tool-1',
      tool_id: 'pi.bash',
      namespace: 'pi',
      description: 'Run command',
      adapter: 'internal',
      target: 'pi',
      operation: 'bash',
      input_schema: {},
      output_schema: {},
      risk: 'write',
      requires_approval: false,
      enabled: true,
      metadata: {},
      created_at: Date.now(),
      updated_at: Date.now(),
    }],
    agent_tool_policies: [{ id: 'policy-1', agent_id: 'agent-1', tool_id: 'pi.bash', effect: 'deny' }],
    tool_approvals: [],
    tool_call_audit: [],
  }

  return {
    collection: (name: string) => ({
      getFirstListItem: async (filter: string) => {
        const items = records[name] ?? []
        if (name === 'runs') return items.find(item => filter.includes(`"${String(item.run_id)}"`)) ?? Promise.reject(new Error('not found'))
        if (name === 'tool_registry') return items.find(item => filter.includes(`"${String(item.tool_id)}"`) && item.enabled !== false) ?? Promise.reject(new Error('not found'))
        return Promise.reject(new Error('not found'))
      },
      getOne: async (id: string) => {
        const item = (records[name] ?? []).find(record => record.id === id)
        if (!item) throw new Error('not found')
        return item
      },
      getFullList: async () => records[name] ?? [],
      create: async (data: Record<string, unknown>) => {
        const id = `${name}-${records[name]?.length ?? 0}`
        const item = { id, ...data }
        records[name] = [...(records[name] ?? []), item]
        return item
      },
    }),
  } as unknown as Database
}

const toolCall = {
  agentId: 'agent-1',
  sessionId: 'session-1',
  runId: 'run-1',
  toolCallId: 'tool-call-1',
  toolName: 'bash',
  input: { command: 'pwd' },
}

describe('pi tool policy', () => {
  it('maps Pi built-in tools to Subpolar tool ids', () => {
    expect(mapPiToolName('read')).toBe('pi.read')
    expect(mapPiToolName('write')).toBe('pi.write')
    expect(mapPiToolName('edit')).toBe('pi.edit')
    expect(mapPiToolName('bash')).toBe('pi.bash')
    expect(mapPiToolName('grep')).toBe('pi.grep')
    expect(mapPiToolName('find')).toBe('pi.find')
    expect(mapPiToolName('ls')).toBe('pi.ls')
  })

  it('returns null for unknown Pi tools', () => {
    expect(mapPiToolName('webfetch')).toBeNull()
  })

  it('uses the agent policy when no run override is set', async () => {
    await expect(authorizePiToolCall(createDb(), toolCall)).resolves.toMatchObject({
      ok: false,
      decision: 'deny',
    })
  })

  it('asks for approval when the run override is ask', async () => {
    await expect(authorizePiToolCall(createDb('ask'), toolCall)).resolves.toMatchObject({
      ok: false,
      decision: 'approval',
    })
  })

  it('denies tool calls when the run override is none', async () => {
    await expect(authorizePiToolCall(createDb('none'), toolCall)).resolves.toMatchObject({
      ok: false,
      decision: 'deny',
    })
  })

  it('allows enabled Pi tools when the run override is allow_all', async () => {
    await expect(authorizePiToolCall(createDb('allow_all'), toolCall)).resolves.toEqual({
      ok: true,
      decision: 'allow',
    })
  })
})
