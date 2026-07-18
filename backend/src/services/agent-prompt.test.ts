import { describe, expect, it } from 'vitest'
import { buildAgentPrompt } from './agent-prompt'

describe('buildAgentPrompt', () => {
  it('does not include a tools section', () => {
    const result = buildAgentPrompt({ agentPrompt: 'Use available skills.' })

    expect(result.prompt).not.toContain('## Tools')
  })

  it('omits project instructions when they are unavailable', () => {
    const result = buildAgentPrompt({ agentPrompt: 'Use available skills.' })

    expect(result.prompt).not.toContain('## Project Instructions')
    expect(result.prompt).not.toContain('Project instructions unavailable')
  })

  it('includes project instructions when they are available', () => {
    const result = buildAgentPrompt({ projectInstructions: 'Follow the project conventions.' })

    expect(result.prompt).toContain('## Project Instructions\nFollow the project conventions.')
  })

  it('builds a skills-only capability prompt', () => {
    const result = buildAgentPrompt({
      skillAccess: [{ id: 'tool-weather-get', discovery: 'name', source: 'tool-default' }],
      skills: [{
        name: 'tool-weather-get',
        description: 'Auto-generated skill for weather.get',
        body: '',
        scope: 'global',
        location: 'subpolar-tool://weather.get',
        source: 'auto',
      }],
    })

    expect(result.prompt).not.toContain('## Tools')
    expect(result.prompt).toContain('## Skills\n### tool-weather-get')
  })

  it('does not add skills to the prompt unless they are explicitly configured', () => {
    const result = buildAgentPrompt({
      skills: [{
        name: 'tool-weather-get',
        description: 'Auto-generated skill for weather.get',
        body: '',
        scope: 'global',
        location: 'subpolar-tool://weather.get',
        source: 'auto',
      }],
    })

    expect(result.prompt).not.toContain('tool-weather-get')
  })
})
