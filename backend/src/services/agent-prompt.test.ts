import { describe, expect, it } from 'vitest'
import { buildAgentPrompt } from './agent-prompt'

describe('buildAgentPrompt', () => {
  it('excludes denied tools from the generated prompt', () => {
    const result = buildAgentPrompt({
      tools: [
        { id: 'edit', permission: 'allow' },
        { id: 'webfetch', permission: 'ask' },
        { id: 'bash', permission: 'deny' },
        { id: 'missing-permission' },
      ],
    })

    expect(result.prompt).toContain('- edit: allow')
    expect(result.prompt).toContain('- webfetch: ask')
    expect(result.prompt).not.toContain('bash')
    expect(result.prompt).not.toContain('missing-permission')
  })

  it('uses the no-access message when all tools are denied', () => {
    const result = buildAgentPrompt({ tools: [{ id: 'bash', permission: 'deny' }] })

    expect(result.prompt).toContain('No explicit tool access configured')
  })
})
