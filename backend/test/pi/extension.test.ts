import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeToolCall, createAuthorizationRequest } from '../../src/pi/extension'

const envKeys = [
  'SUBPOLAR_AGENT_ID',
  'SUBPOLAR_SESSION_ID',
  'SUBPOLAR_RUN_ID',
  'SUBPOLAR_BASE_URL',
  'SUBPOLAR_INTERNAL_TOKEN',
]

function setEnv() {
  process.env.SUBPOLAR_AGENT_ID = 'agent-1'
  process.env.SUBPOLAR_SESSION_ID = 'session-1'
  process.env.SUBPOLAR_RUN_ID = 'run-1'
  process.env.SUBPOLAR_BASE_URL = 'http://localhost:5003'
  process.env.SUBPOLAR_INTERNAL_TOKEN = 'token'
}

describe('pi extension authorization', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    for (const key of envKeys) delete process.env[key]
  })

  it('creates authorization requests from Pi tool calls', () => {
    setEnv()

    expect(createAuthorizationRequest({
      id: 'tool-call-1',
      name: 'bash',
      input: { command: 'pwd' },
      cwd: '/tmp/project',
    })).toEqual({
      agentId: 'agent-1',
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-call-1',
      toolName: 'bash',
      input: { command: 'pwd' },
      cwd: '/tmp/project',
    })
  })

  it('allows when Subpolar allows', async () => {
    setEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, decision: 'allow' }), { status: 200 })))

    await expect(authorizeToolCall({ id: 'tool-call-1', name: 'read', input: {} })).resolves.toBeUndefined()
  })

  it('blocks when required configuration is missing', async () => {
    const result = await authorizeToolCall({ id: 'tool-call-1', name: 'read', input: {} })

    expect(result).toEqual({ block: true, reason: 'SUBPOLAR_AGENT_ID is required' })
  })

  it('blocks when Subpolar requires approval', async () => {
    setEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, decision: 'approval', message: 'pi.edit requires approval' }), { status: 200 })))

    await expect(authorizeToolCall({ id: 'tool-call-1', name: 'edit', input: {} })).resolves.toEqual({ block: true, reason: 'pi.edit requires approval' })
  })
})
