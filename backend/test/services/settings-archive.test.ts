import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../src/db/schema'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
  })),
}))

import { SettingsService } from '../../src/services/settings'

describe('SettingsService - archiveBrokenConfig', () => {
  let settingsService: SettingsService
  let mockGetDefaultConfig: ReturnType<typeof vi.fn>
  let mockCreatePiConfig: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    settingsService = new SettingsService({ query: vi.fn() } as unknown as Database)
    mockGetDefaultConfig = vi.fn()
    mockCreatePiConfig = vi.fn()
    vi.spyOn(settingsService, 'getDefaultPiConfig').mockImplementation(mockGetDefaultConfig)
    vi.spyOn(settingsService, 'createPiConfig').mockImplementation(mockCreatePiConfig)
  })

  it('creates a broken config backup with default-broken prefix', async () => {
    const defaultConfig = {
      id: 1,
      name: 'default',
      rawContent: '{"$schema": "https://opencode.ai/config.json"}',
      isValid: true,
      content: { '$schema': 'https://opencode.ai/config.json' },
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    mockGetDefaultConfig.mockReturnValue(defaultConfig)
    mockCreatePiConfig.mockReturnValue({
      ...defaultConfig,
      id: 2,
      name: 'default-broken-2026-04-25T00-00-00-000Z',
      isDefault: false,
    })

    const backupName = await settingsService.archiveBrokenConfig()

    expect(backupName).toMatch(/^default-broken-/)
    expect(mockCreatePiConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^default-broken-/),
        content: defaultConfig.rawContent,
        isDefault: false,
      }),
    )
  })

  it('returns null when no default config exists', async () => {
    mockGetDefaultConfig.mockReturnValue(null)

    const result = await settingsService.archiveBrokenConfig()

    expect(result).toBeNull()
    expect(mockCreatePiConfig).not.toHaveBeenCalled()
  })
})
