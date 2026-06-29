import type PocketBase from 'pocketbase'
import { unlinkSync, existsSync } from 'fs'
import { getPiConfigFilePath } from '@subpolar/shared/config/env'
import { logger } from '../utils/logger'
import { parseJsonc } from '@subpolar/shared/utils'
import { z } from 'zod'
import type { 
  UserPreferences, 
  SettingsResponse, 
  CreatePiConfigRequest as CreateOpenCodeConfigRequest,
  UpdatePiConfigRequest as UpdateOpenCodeConfigRequest
} from '../types/settings'
import {
  UserPreferencesSchema,
  PiConfigSchema as OpenCodeConfigSchema,
  DEFAULT_USER_PREFERENCES,
} from '../types/settings'

interface OpenCodeConfigValidationIssue {
  path: string
  message: string
}

interface OpenCodeConfigWithRaw {
  id: number
  name: string
  content: Record<string, unknown>
  rawContent: string
  validationIssues?: OpenCodeConfigValidationIssue[]
  isValid: boolean
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

interface OpenCodeConfigResponseWithRaw {
  configs: OpenCodeConfigWithRaw[]
  defaultConfig: OpenCodeConfigWithRaw | null
}

interface CreateOpenCodeConfigOptions {
  suppressAutoDefault?: boolean
}

interface PrefsRecord {
  id: string
  user_id: string
  preferences: string
  updated_at: number
}

interface ConfigRecord {
  id: string
  user_id: string
  config_name: string
  config_content: string
  is_default: boolean
  created_at: number
  updated_at: number
}

export class SettingsService {
  private static lastKnownGoodConfigContent: string | null = null

  constructor(private pb: PocketBase) {}

  private getValidationIssues(error: z.ZodError): OpenCodeConfigValidationIssue[] {
    return error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : 'root',
      message: issue.message,
    }))
  }

  private parseStoredConfig(rawContent: string, configName: string): { content: Record<string, unknown>; validationIssues?: OpenCodeConfigValidationIssue[]; isValid: boolean } {
    const parsed = parseJsonc(rawContent)
    const content = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}

    const validated = OpenCodeConfigSchema.safeParse(parsed)
    if (validated.success) {
      return {
        content: validated.data as Record<string, unknown>,
        isValid: true,
      }
    }

    const validationIssues = this.getValidationIssues(validated.error)
    logger.error(`Failed to validate config ${configName}: ${validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)

    return {
      content,
      validationIssues,
      isValid: false,
    }
  }

  initializeLastKnownGoodConfig(userId: string = 'default'): void {
    this.getSettings(userId).then((settings) => {
      if (settings.preferences.lastKnownGoodConfig) {
        SettingsService.lastKnownGoodConfigContent = settings.preferences.lastKnownGoodConfig
        logger.info('Initialized last known good config from database')
      }
    })
  }

  async persistLastKnownGoodConfig(userId: string = 'default'): Promise<void> {
    if (SettingsService.lastKnownGoodConfigContent) {
      await this.updateSettings({ lastKnownGoodConfig: SettingsService.lastKnownGoodConfigContent }, userId)
      logger.info('Persisted last known good config to database')
    }
  }

  async getSettings(userId: string = 'default'): Promise<SettingsResponse> {
    try {
      const record = await this.pb.collection('user_preferences').getFirstListItem(`user_id = "${userId}"`)
      const row = record as unknown as PrefsRecord

      try {
        const raw = typeof row.preferences === 'string' ? parseJsonc(row.preferences) : row.preferences
        const parsed = (raw ?? {}) as Record<string, unknown>
        const validated = UserPreferencesSchema.parse({
          ...DEFAULT_USER_PREFERENCES,
          ...parsed,
        })
        return {
          preferences: validated,
          updatedAt: row.updated_at,
        }
      } catch (error) {
        logger.error('Failed to parse user preferences, returning defaults', error)
        return {
          preferences: DEFAULT_USER_PREFERENCES,
          updatedAt: row.updated_at,
        }
      }
    } catch {
      return {
        preferences: DEFAULT_USER_PREFERENCES,
        updatedAt: Date.now(),
      }
    }
  }

  async updateSettings(
    updates: Partial<UserPreferences>,
    userId: string = 'default'
  ): Promise<SettingsResponse> {
    const current = await this.getSettings(userId)
    const merged: UserPreferences = {
      ...current.preferences,
      ...updates,
    }

    const validated = UserPreferencesSchema.parse(merged)
    const updatedAt = Date.now()

    try {
      const existing = await this.pb.collection('user_preferences').getFirstListItem(`user_id = "${userId}"`)
      await this.pb.collection('user_preferences').update(existing.id, {
        preferences: validated,
        updated_at: updatedAt,
      })
    } catch {
      await this.pb.collection('user_preferences').create({
        user_id: userId,
        preferences: validated,
        updated_at: updatedAt,
      })
    }

    logger.info(`Updated preferences for user: ${userId}`)
    return { preferences: validated, updatedAt }
  }

  async resetSettings(userId: string = 'default'): Promise<SettingsResponse> {
    try {
      const existing = await this.pb.collection('user_preferences').getFirstListItem(`user_id = "${userId}"`)
      await this.pb.collection('user_preferences').delete(existing.id)
    } catch {
      // ignore if not found
    }

    logger.info(`Reset preferences for user: ${userId}`)
    return {
      preferences: DEFAULT_USER_PREFERENCES,
      updatedAt: Date.now(),
    }
  }

  async getOpenCodeConfigs(userId: string = 'default'): Promise<OpenCodeConfigResponseWithRaw> {
    const result = await this.pb.collection('opencode_configs').getFullList({
      filter: `user_id = "${userId}"`,
      sort: '-created_at',
    })
    const rows = result as unknown as ConfigRecord[]

    const configs: OpenCodeConfigWithRaw[] = []
    let defaultConfig: OpenCodeConfigWithRaw | null = null

    for (const row of rows) {
      try {
        const rawContent = row.config_content
        const parsedConfig = this.parseStoredConfig(rawContent, row.config_name)

        const config: OpenCodeConfigWithRaw = {
          id: parseInt(row.id, 10),
          name: row.config_name,
          content: parsedConfig.content,
          rawContent: rawContent,
          validationIssues: parsedConfig.validationIssues,
          isValid: parsedConfig.isValid,
          isDefault: Boolean(row.is_default),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }

        configs.push(config)

        if (config.isDefault) {
          defaultConfig = config
        }
      } catch (error) {
        logger.error(`Failed to parse config ${row.config_name}:`, error)
      }
    }

    return { configs, defaultConfig }
  }

  async createOpenCodeConfig(
    request: CreateOpenCodeConfigRequest,
    userId: string = 'default',
    options: CreateOpenCodeConfigOptions = {}
  ): Promise<OpenCodeConfigWithRaw> {
    const existing = await this.getOpenCodeConfigByName(request.name, userId)
    if (existing) {
      throw new Error(`Config with name '${request.name}' already exists`)
    }

    const rawContent = typeof request.content === 'string' 
      ? request.content 
      : JSON.stringify(request.content, null, 2)

    const parsedContent = typeof request.content === 'string'
      ? parseJsonc(request.content)
      : request.content

    const contentValidated = OpenCodeConfigSchema.parse(parsedContent)
    const now = Date.now()

    const existingConfigs = await this.pb.collection('opencode_configs').getFullList({
      filter: `user_id = "${userId}"`,
    })
    const shouldBeDefault = request.isDefault || (!options.suppressAutoDefault && existingConfigs.length === 0)

    if (shouldBeDefault) {
      const allConfigs = await this.pb.collection('opencode_configs').getFullList({
        filter: `user_id = "${userId}" && is_default = true`,
      })
      for (const c of allConfigs) {
        await this.pb.collection('opencode_configs').update(c.id, { is_default: false })
      }
    }

    const record = await this.pb.collection('opencode_configs').create({
      user_id: userId,
      config_name: request.name,
      config_content: rawContent,
      is_default: shouldBeDefault,
      created_at: now,
      updated_at: now,
    })

    const config: OpenCodeConfigWithRaw = {
      id: parseInt(record.id, 10),
      name: request.name,
      content: contentValidated as Record<string, unknown>,
      rawContent: rawContent,
      isValid: true,
      isDefault: shouldBeDefault,
      createdAt: now,
      updatedAt: now,
    }

    logger.info(`Created PiInternal config '${config.name}' for user: ${userId}`)
    return config
  }

  async updateOpenCodeConfig(
    configName: string,
    request: UpdateOpenCodeConfigRequest,
    userId: string = 'default'
  ): Promise<OpenCodeConfigWithRaw | null> {
    let existing: ConfigRecord | null = null
    try {
      const record = await this.pb.collection('opencode_configs').getFirstListItem(
        `user_id = "${userId}" && config_name = "${configName}"`
      )
      existing = record as unknown as ConfigRecord
    } catch {
      return null
    }

    const rawContent = typeof request.content === 'string' 
      ? request.content 
      : JSON.stringify(request.content, null, 2)

    const parsedContent = typeof request.content === 'string'
      ? parseJsonc(request.content)
      : request.content

    const contentValidated = OpenCodeConfigSchema.parse(parsedContent)
    const now = Date.now()

    if (request.isDefault) {
      const allDefaults = await this.pb.collection('opencode_configs').getFullList({
        filter: `user_id = "${userId}" && is_default = true`,
      })
      for (const c of allDefaults) {
        await this.pb.collection('opencode_configs').update(c.id, { is_default: false })
      }
    }

    await this.pb.collection('opencode_configs').update(existing.id, {
      config_content: rawContent,
      is_default: request.isDefault !== undefined ? request.isDefault : existing.is_default,
      updated_at: now,
    })

    const config: OpenCodeConfigWithRaw = {
      id: parseInt(existing.id, 10),
      name: configName,
      content: contentValidated as Record<string, unknown>,
      rawContent: rawContent,
      isValid: true,
      isDefault: request.isDefault !== undefined ? request.isDefault : existing.is_default,
      createdAt: existing.created_at,
      updatedAt: now,
    }

    logger.info(`Updated PiInternal config '${configName}' for user: ${userId}`)
    return config
  }

  async deleteOpenCodeConfig(configName: string, userId: string = 'default'): Promise<boolean> {
    try {
      const record = await this.pb.collection('opencode_configs').getFirstListItem(
        `user_id = "${userId}" && config_name = "${configName}"`
      )
      await this.pb.collection('opencode_configs').delete(record.id)
      logger.info(`Deleted PiInternal config '${configName}' for user: ${userId}`)
      await this.ensureSingleConfigIsDefault(userId)
      return true
    } catch {
      return false
    }
  }

  async setDefaultOpenCodeConfig(configName: string, userId: string = 'default'): Promise<OpenCodeConfigWithRaw | null> {
    let existing: ConfigRecord | null = null
    try {
      const record = await this.pb.collection('opencode_configs').getFirstListItem(
        `user_id = "${userId}" && config_name = "${configName}"`
      )
      existing = record as unknown as ConfigRecord
    } catch {
      return null
    }

    const allDefaults = await this.pb.collection('opencode_configs').getFullList({
      filter: `user_id = "${userId}" && is_default = true`,
    })
    for (const c of allDefaults) {
      await this.pb.collection('opencode_configs').update(c.id, { is_default: false })
    }

    const now = Date.now()
    await this.pb.collection('opencode_configs').update(existing.id, {
      is_default: true,
      updated_at: now,
    })

    try {
      const rawContent = existing.config_content
      const parsedConfig = this.parseStoredConfig(rawContent, configName)

      return {
        id: parseInt(existing.id, 10),
        name: configName,
        content: parsedConfig.content,
        rawContent: rawContent,
        validationIssues: parsedConfig.validationIssues,
        isValid: parsedConfig.isValid,
        isDefault: true,
        createdAt: existing.created_at,
        updatedAt: now,
      }
    } catch (error) {
      logger.error(`Failed to parse config ${configName}:`, error)
      return null
    }
  }

  async getDefaultOpenCodeConfig(userId: string = 'default'): Promise<OpenCodeConfigWithRaw | null> {
    try {
      const record = await this.pb.collection('opencode_configs').getFirstListItem(
        `user_id = "${userId}" && is_default = true`
      )
      const row = record as unknown as ConfigRecord

      const rawContent = row.config_content
      const parsedConfig = this.parseStoredConfig(rawContent, row.config_name)

      return {
        id: parseInt(row.id, 10),
        name: row.config_name,
        content: parsedConfig.content,
        rawContent: rawContent,
        validationIssues: parsedConfig.validationIssues,
        isValid: parsedConfig.isValid,
        isDefault: true,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    } catch {
      return null
    }
  }

  async getOpenCodeConfigByName(configName: string, userId: string = 'default'): Promise<OpenCodeConfigWithRaw | null> {
    try {
      const record = await this.pb.collection('opencode_configs').getFirstListItem(
        `user_id = "${userId}" && config_name = "${configName}"`
      )
      const row = record as unknown as ConfigRecord

      const rawContent = row.config_content
      const parsedConfig = this.parseStoredConfig(rawContent, configName)

      return {
        id: parseInt(row.id, 10),
        name: configName,
        content: parsedConfig.content,
        rawContent: rawContent,
        validationIssues: parsedConfig.validationIssues,
        isValid: parsedConfig.isValid,
        isDefault: Boolean(row.is_default),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    } catch {
      return null
    }
  }

  async getOpenCodeConfigContent(configName: string, userId: string = 'default'): Promise<string | null> {
    try {
      const record = await this.pb.collection('opencode_configs').getFirstListItem(
        `user_id = "${userId}" && config_name = "${configName}"`
      )
      return (record as unknown as ConfigRecord).config_content
    } catch {
      logger.error(`Config '${configName}' not found for user ${userId}`)
      return null
    }
  }

  async ensureSingleConfigIsDefault(userId: string = 'default'): Promise<void> {
    const defaults = await this.pb.collection('opencode_configs').getFullList({
      filter: `user_id = "${userId}" && is_default = true`,
    })
    if (defaults.length === 0) {
      const configs = await this.pb.collection('opencode_configs').getFullList({
        filter: `user_id = "${userId}"`,
        sort: 'created_at',
        limit: 1,
      })
      if (configs.length > 0 && configs[0]) {
        await this.pb.collection('opencode_configs').update(configs[0].id, { is_default: true })
        logger.info(`Auto-set '${(configs[0] as unknown as ConfigRecord).config_name}' as default (only config)`)
      }
    }
  }

  async saveLastKnownGoodConfig(userId: string = 'default'): Promise<void> {
    const config = await this.getDefaultOpenCodeConfig(userId)
    if (config) {
      SettingsService.lastKnownGoodConfigContent = config.rawContent
      await this.persistLastKnownGoodConfig(userId)
      logger.info(`Saved last known good config: ${config.name}`)
    }
  }

  async archiveBrokenConfig(userId: string = 'default'): Promise<string | null> {
    const current = await this.getDefaultOpenCodeConfig(userId)
    if (!current) return null

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `${current.name}-broken-${ts}`
    try {
      await this.createOpenCodeConfig(
        {
          name: backupName,
          content: current.rawContent,
          isDefault: false,
        },
        userId,
        { suppressAutoDefault: true },
      )
      logger.warn(`Archived broken PiInternal config as '${backupName}'`)
      return backupName
    } catch (error) {
      logger.error('Failed to archive broken config:', error)
      return null
    }
  }

  async restoreToLastKnownGoodConfig(userId: string = 'default'): Promise<{ configName: string; content: string } | null> {
    if (!SettingsService.lastKnownGoodConfigContent) {
      logger.warn('No last known good config available for rollback')
      return null
    }

    const configs = await this.getOpenCodeConfigs(userId)
    const defaultConfig = configs.defaultConfig

    if (!defaultConfig) {
      logger.error('Cannot rollback: no default config found')
      return null
    }

    logger.info(`Restoring to last known good config for: ${defaultConfig.name}`)
    return {
      configName: defaultConfig.name,
      content: SettingsService.lastKnownGoodConfigContent
    }
  }

  async rollbackToLastKnownGoodHealth(userId: string = 'default'): Promise<string | null> {
    const lastGood = await this.restoreToLastKnownGoodConfig(userId)
    if (!lastGood) return null

    await this.updateOpenCodeConfig(lastGood.configName, { content: lastGood.content }, userId)
    return lastGood.configName
  }

  deleteFilesystemConfig(): boolean {
    const configPath = getPiConfigFilePath()

    if (!existsSync(configPath)) {
      logger.warn('Config file does not exist:', configPath)
      return false
    }

    try {
      unlinkSync(configPath)
      logger.info('Deleted filesystem config to allow server startup:', configPath)
      return true
    } catch (error) {
      logger.error('Failed to delete config file:', error)
      return false
    }
  }

}
