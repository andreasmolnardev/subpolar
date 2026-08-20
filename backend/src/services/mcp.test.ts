import { describe, expect, it } from 'vitest'
import { IntegrationConfigSchema } from '@subpolar/shared'
import { dockerCommand } from './mcp'

describe('dockerCommand', () => {
  it('builds direct Docker argv and forwards environment by name', () => {
    expect(dockerCommand({
      transport: 'stdio',
      execution: 'docker',
      image: 'docker.gitea.com/gitea-mcp-server',
      args: ['--config', 'value with spaces', '$(not-a-shell-command)'],
      environment: { GITEA_ACCESS_TOKEN: 'secret', OTHER: 'value' },
    })).toEqual([
      'docker', 'run', '-i', '--rm',
      '-e', 'GITEA_ACCESS_TOKEN', '-e', 'OTHER',
      'docker.gitea.com/gitea-mcp-server', '--config', 'value with spaces', '$(not-a-shell-command)',
    ])
  })
})

describe('MCP integration schema', () => {
  it('accepts local, remote, Docker, and legacy local MCP configurations', () => {
    const base = { id: 'server', name: 'Server', enabled: true, type: 'mcp' as const }
    expect(IntegrationConfigSchema.safeParse({ ...base, transport: 'stdio', command: ['npx', 'server'] }).success).toBe(true)
    expect(IntegrationConfigSchema.safeParse({ ...base, transport: 'streamable-http', serverUrl: 'https://mcp.example.com' }).success).toBe(true)
    expect(IntegrationConfigSchema.safeParse({ ...base, transport: 'stdio', execution: 'docker', image: 'example/mcp', args: ['--readonly'] }).success).toBe(true)
    expect(IntegrationConfigSchema.safeParse({ ...base, transport: 'stdio', execution: 'invalid' }).success).toBe(false)
  })
})
