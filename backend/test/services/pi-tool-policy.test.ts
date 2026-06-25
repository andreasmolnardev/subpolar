import { describe, expect, it } from 'vitest'
import { mapPiToolName } from '../../src/pi/tool-policy'

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
})
