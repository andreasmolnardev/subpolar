import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeMcpOAuthFlow, getMcpOAuthFlowResult, storeMcpOAuthFlow } from '../../src/services/mcp-oauth-state'

const flow = {
  serverName: 'calendar',
  serverUrl: 'https://calendar.example.com/mcp',
  codeVerifier: 'verifier',
  clientId: 'client',
  callbackUrl: 'https://subpolar.example.com/callback',
  tokenEndpoint: 'https://calendar.example.com/token',
}

describe('MCP OAuth state', () => {
  afterEach(() => vi.useRealTimers())

  it('expires flows and results lazily without a background timer', () => {
    vi.useFakeTimers()
    storeMcpOAuthFlow('expired-flow', flow)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)

    expect(consumeMcpOAuthFlow('expired-flow')).toBeUndefined()
    expect(getMcpOAuthFlowResult('expired-flow')).toBeUndefined()
  })
})
