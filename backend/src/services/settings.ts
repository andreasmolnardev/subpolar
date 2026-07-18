import type PocketBase from 'pocketbase'
import { existsSync, unlinkSync } from 'fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import path from 'path'
import { getPiConfigFilePath } from '@subpolar/shared/config/env'
import { parseJsonc } from '@subpolar/shared/utils'
import { z } from 'zod'
import type {
  CreatePiConfigRequest,
  SettingsResponse,
  UpdatePiConfigRequest,
  UserPreferences,
} from '../types/settings'
import {
  DEFAULT_USER_PREFERENCES,
  PiConfigSchema,
  UserPreferencesSchema,
} from '../types/settings'
import { logger } from '../utils/logger'

interface PiConfigValidationIssue {
  path: string
  message: string
}

interface PiConfigWithRaw {
  id: number
  name: string
  content: Record<string, unknown>
  rawContent: string
  validationIssues?: PiConfigValidationIssue[]
  isValid: boolean
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

interface PiConfigResponseWithRaw {
  configs: PiConfigWithRaw[]
  defaultConfig: PiConfigWithRaw | null
}

interface PrefsRecord {
  id: string
  user_id: string
  preferences: string
  updated_at: number
}

const DEFAULT_CONFIG_NAME = 'default'

function configDirectory(): string {
  return path.join(path.dirname(getPiConfigFilePath()), 'profiles')
}

function profilePath(name: string): string {
  const safeName = name.trim()
  if (!safeName || safeName === DEFAULT_CONFIG_NAME || safeName.includes('/') || safeName.includes('\\') || safeName === '.' || safeName === '..') {
    return getPiConfigFilePath()
  }
  return path.join(configDirectory(), `${safeName}.json`)
}

function configNameFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

export class SettingsService {
  private static lastKnownGoodConfigContent: string | null = null

  constructor(private readonly pb: PocketBase) {}

  private getValidationIssues(error: z.ZodError): PiConfigValidationIssue[] {
    return error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : 'root',
      message: issue.message,
    }))
  }

  private parseStoredConfig(rawContent: string, configName: string): { content: Record<string, unknown>; validationIssues?: PiConfigValidationIssue[]; isValid: boolean } {
    const parsed = parseJsonc(rawContent)
    const content = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
    const validated = PiConfigSchema.safeParse(parsed)
    if (validated.success) return { content: validated.data as Record<string, unknown>, isValid: true }

    const validationIssues = this.getValidationIssues(validated.error)
    logger.error(`Failed to validate Pi config ${configName}: ${validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)
    return { content, validationIssues, isValid: false }
  }

  private async readConfig(name: string): Promise<PiConfigWithRaw | null> {
    const filePath = profilePath(name)
    try {
      const [rawContent, details] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)])
      const parsed = this.parseStoredConfig(rawContent, name)
      return {
        id: name === DEFAULT_CONFIG_NAME ? 0 : Math.abs([...name].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)),
        name,
        content: parsed.content,
        rawContent,
        validationIssues: parsed.validationIssues,
        isValid: parsed.isValid,
        isDefault: name === DEFAULT_CONFIG_NAME,
        createdAt: details.birthtimeMs || details.ctimeMs,
        updatedAt: details.mtimeMs,
      }
    } catch {
      return null
    }
  }

  private async configPaths(): Promise<string[]> {
    const paths = existsSync(getPiConfigFilePath()) ? [getPiConfigFilePath()] : []
    try {
      const entries = await readdir(configDirectory(), { withFileTypes: true })
      paths.push(...entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(configDirectory(), entry.name)))
    } catch {
      return paths
    }
    return paths
  }

  initializeLastKnownGoodConfig(): void {
    void this.readConfig(DEFAULT_CONFIG_NAME).then((config) => {
      if (config) SettingsService.lastKnownGoodConfigContent = config.rawContent
    })
  }

  async getSettings(userId = 'default'): Promise<SettingsResponse> {
    try {
      const record = await this.pb.collection('user_preferences').getFirstListItem(`user_id = "${userId}"`)
      const row = record as unknown as PrefsRecord
      try {
        const raw = typeof row.preferences === 'string' ? parseJsonc(row.preferences) : row.preferences
        const validated = UserPreferencesSchema.parse({ ...DEFAULT_USER_PREFERENCES, ...(raw ?? {}) })
        return { preferences: validated, updatedAt: row.updated_at }
      } catch (error) {
        logger.error('Failed to parse user preferences, returning defaults', error)
        return { preferences: DEFAULT_USER_PREFERENCES, updatedAt: row.updated_at }
      }
    } catch {
      return { preferences: DEFAULT_USER_PREFERENCES, updatedAt: Date.now() }
    }
  }

  async updateSettings(updates: Partial<UserPreferences>, userId = 'default'): Promise<SettingsResponse> {
    const current = await this.getSettings(userId)
    const validated = UserPreferencesSchema.parse({ ...current.preferences, ...updates })
    const updatedAt = Date.now()
    try {
      const existing = await this.pb.collection('user_preferences').getFirstListItem(`user_id = "${userId}"`)
      await this.pb.collection('user_preferences').update(existing.id, { preferences: validated, updated_at: updatedAt })
    } catch {
      await this.pb.collection('user_preferences').create({ user_id: userId, preferences: validated, updated_at: updatedAt })
    }
    return { preferences: validated, updatedAt }
  }

  async resetSettings(userId = 'default'): Promise<SettingsResponse> {
    try {
      const existing = await this.pb.collection('user_preferences').getFirstListItem(`user_id = "${userId}"`)
      await this.pb.collection('user_preferences').delete(existing.id)
    } catch {
    }
    return { preferences: DEFAULT_USER_PREFERENCES, updatedAt: Date.now() }
  }

  async getPiConfigs(): Promise<PiConfigResponseWithRaw> {
    const configs = (await Promise.all((await this.configPaths()).map((filePath) => this.readConfig(configNameFromPath(filePath) === 'opencode' ? DEFAULT_CONFIG_NAME : configNameFromPath(filePath)))))
      .filter((config): config is PiConfigWithRaw => config !== null)
    const defaultConfig = configs.find((config) => config.isDefault) ?? null
    return { configs, defaultConfig }
  }

  async createPiConfig(request: CreatePiConfigRequest): Promise<PiConfigWithRaw> {
    const existing = await this.getPiConfigByName(request.name)
    if (existing) throw new Error(`Pi config with name '${request.name}' already exists`)
    const rawContent = typeof request.content === 'string' ? request.content : JSON.stringify(request.content, null, 2)
    const parsedContent = typeof request.content === 'string' ? parseJsonc(request.content) : request.content
    const content = PiConfigSchema.parse(parsedContent)
    const filePath = profilePath(request.name)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, rawContent, 'utf8')
    return (await this.readConfig(request.name)) ?? {
      id: 0,
      name: request.name,
      content: content as Record<string, unknown>,
      rawContent,
      isValid: true,
      isDefault: request.name === DEFAULT_CONFIG_NAME,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  async updatePiConfig(configName: string, request: UpdatePiConfigRequest): Promise<PiConfigWithRaw | null> {
    if (!await this.getPiConfigByName(configName)) return null
    const rawContent = typeof request.content === 'string' ? request.content : JSON.stringify(request.content, null, 2)
    PiConfigSchema.parse(typeof request.content === 'string' ? parseJsonc(request.content) : request.content)
    await writeFile(profilePath(configName), rawContent, 'utf8')
    return this.readConfig(configName)
  }

  async deletePiConfig(configName: string): Promise<boolean> {
    try {
      await rm(profilePath(configName))
      return true
    } catch {
      return false
    }
  }

  async setDefaultPiConfig(configName: string): Promise<PiConfigWithRaw | null> {
    const config = await this.getPiConfigByName(configName)
    if (!config) return null
    await mkdir(path.dirname(getPiConfigFilePath()), { recursive: true })
    await writeFile(getPiConfigFilePath(), config.rawContent, 'utf8')
    return this.readConfig(DEFAULT_CONFIG_NAME)
  }

  async getDefaultPiConfig(): Promise<PiConfigWithRaw | null> {
    return this.readConfig(DEFAULT_CONFIG_NAME)
  }

  async getPiConfigByName(configName: string): Promise<PiConfigWithRaw | null> {
    return this.readConfig(configName)
  }

  async getPiConfigContent(configName: string): Promise<string | null> {
    const config = await this.getPiConfigByName(configName)
    return config?.rawContent ?? null
  }

  async saveLastKnownGoodConfig(): Promise<void> {
    const config = await this.getDefaultPiConfig()
    if (config) SettingsService.lastKnownGoodConfigContent = config.rawContent
  }

  async archiveBrokenConfig(): Promise<string | null> {
    const current = await this.getDefaultPiConfig()
    if (!current) return null
    const name = `default-broken-${new Date().toISOString().replace(/[:.]/g, '-')}`
    await this.createPiConfig({ name, content: current.rawContent, isDefault: false })
    return name
  }

  async rollbackToLastKnownGoodHealth(): Promise<string | null> {
    if (!SettingsService.lastKnownGoodConfigContent) return null
    await writeFile(getPiConfigFilePath(), SettingsService.lastKnownGoodConfigContent, 'utf8')
    return DEFAULT_CONFIG_NAME
  }

  deleteFilesystemConfig(): boolean {
    const configPath = getPiConfigFilePath()
    if (!existsSync(configPath)) return false
    try {
      unlinkSync(configPath)
      return true
    } catch {
      return false
    }
  }
}
