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

  it('includes generated tool parameters for full discovery', () => {
    const result = buildAgentPrompt({
      skillAccess: [{ id: 'tool-openapi-wttr-in-getweather', discovery: 'full', source: 'tool-default' }],
      skills: [{
        name: 'tool-openapi-wttr-in-getweather',
        description: 'Auto-generated skill for openapi.wttr-in.getWeather: Get current weather and forecast for a location from openapi',
        body: 'Load tool-openapi-wttr-in-getweather with skill-load for the tool\'s full instructions and schema.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        scope: 'global',
        location: 'subpolar-tool://openapi.wttr-in.getWeather',
        source: 'auto',
      }],
    })

    expect(result.prompt).toContain('Tool call parameters:')
    expect(result.prompt).toContain('"query": {')
    expect(result.prompt).toContain('"required": [')
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
