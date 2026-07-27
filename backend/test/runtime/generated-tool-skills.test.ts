import { describe, expect, it } from 'vitest'
import { createGeneratedToolSkills } from '../../src/runtime/generated-tool-skills'

describe('createGeneratedToolSkills', () => {
  it('maps visible tools to generated skills with stable names', () => {
    expect(createGeneratedToolSkills([{
      id: 'calendar.create-event',
      description: 'Create a calendar event',
      inputSchema: { type: 'object' },
    }])).toEqual([{
      name: 'tool-calendar-create-event',
      description: 'Auto-generated skill for calendar.create-event: Create a calendar event',
      filePath: 'subpolar-tool://calendar.create-event',
      baseDir: '',
      source: 'auto-generated',
      toolId: 'calendar.create-event',
      inputSchema: { type: 'object' },
    }])
  })
})
