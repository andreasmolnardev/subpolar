import { describe, expect, it } from 'vitest'
import { buildAgentPromptPreview } from './agentPromptPreview'

describe('buildAgentPromptPreview', () => {
  it('includes the injected Subpolar instructions', () => {
    const result = buildAgentPromptPreview({
      projectInstructions: '<project_instructions path="/workspace/AGENTS.md">\nUse the project conventions.\n</project_instructions>',
      prompt: 'Use the configured tools.',
    })

    expect(result).toContain('## Project Instructions\n<project_instructions path="/workspace/AGENTS.md">\nUse the project conventions.\n</project_instructions>')
    expect(result).toContain('## Agent Instructions\nUse the configured tools.')
  })
})
