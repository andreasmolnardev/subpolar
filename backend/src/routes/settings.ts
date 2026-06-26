import { Hono } from 'hono'
import { z } from 'zod'
import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import type { Database } from '../db/schema'
import { SettingsService } from '../services/settings'
import { writeFileContent, readFileContent, fileExists } from '../services/file-operations'
import { patchConfigWithRecovery } from '../services/opencode/config-recovery'
import type { OpenCodeClient } from '../services/opencode/client'
import { getOpenCodeConfigFilePath, getAgentsMdPath } from '@subpolar/shared/config/env'
import {
  UserPreferencesSchema,
  OpenCodeConfigSchema,
} from '../types/settings'
import {
  CreateSkillRequestSchema,
  UpdateSkillRequestSchema,
  SkillScopeSchema,
} from '@subpolar/shared'
import { logger } from '../utils/logger'
import { opencodeServerManager, ConfigReloadError } from '../services/opencode-single-server'
import { getOrCreateInternalToken, rotateInternalToken } from '../services/internal-token'
import { sseAggregator } from '../services/sse-aggregator'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import { DEFAULT_AGENTS_MD } from '../constants'
import { compareVersions, isValidVersion } from '../utils/version-utils'
import { getOpenCodeImportStatus, OpenCodeImportProtectionError, syncOpenCodeImport } from '../services/opencode-import'
import { ENV } from '@subpolar/shared/config/env'
import { discoverCalDavCalendars, getUpcomingCalDavEvents } from '../services/caldav'
import {
  listManagedSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
} from '../services/skills'
import {
  createIntegration,
  deleteIntegration,
  listIntegrations,
  normalizeIntegrationType,
  toSettingsIntegrationType,
  updateIntegration,
} from '../db/integrations'
import { listEnabledTools, listPoliciesForAgent, replacePoliciesForAgent } from '../db/subpolar-tools'

const AgentToolPoliciesUpdateSchema = z.object({
  policies: z.array(z.object({
    toolId: z.string().min(1),
    effect: z.enum(['allow', 'deny', 'approval']),
  })),
})

function getOpenCodeInstallMethod(): string {
  const homePath = process.env.HOME || ''
  const opencodePath = process.env.OPENCOD_PATH || resolve(homePath, '.opencode', 'bin', 'opencode')
  
  if (!existsSync(opencodePath)) return 'curl'
  
  try {
    const opencodeDir = dirname(opencodePath)
    if (opencodeDir.includes('.opencode')) return 'curl'
    
    if (opencodePath.includes('/homebrew/') || opencodePath.includes('/HOMEBREW/')) return 'brew'
    if (opencodePath.includes('/.npm/') || opencodePath.includes('/node_modules/')) return 'npm'
    if (opencodePath.includes('/.pnpm/')) return 'pnpm'
    if (opencodePath.includes('/.bun/')) return 'bun'
  } catch {
    return 'curl'
  }
  
  return 'curl'
}

function getOpenCodeConfigContentToWrite(
  rawContent: string,
  appliedConfig?: Record<string, unknown>,
  removedFields?: string[]
): string {
  if (!appliedConfig || !removedFields || removedFields.length === 0) {
    return rawContent
  }

  return JSON.stringify(appliedConfig, null, 2)
}

async function reloadOpenCodeConfig(openCodeSupervisor?: OpenCodeSupervisor): Promise<void> {
  if (openCodeSupervisor) {
    await openCodeSupervisor.reloadConfig('settings_reload')
    return
  }

  await opencodeServerManager.reloadConfig()
}

async function restartOpenCode(openCodeSupervisor?: OpenCodeSupervisor): Promise<void> {
  if (openCodeSupervisor) {
    await openCodeSupervisor.restart('settings_restart')
    return
  }

  opencodeServerManager.clearStartupError()
  await opencodeServerManager.restart()
}

function didConfigFieldChange(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
  field: string
): boolean {
  return JSON.stringify(previous?.[field]) !== JSON.stringify(next?.[field])
}

function needsOpenCodeRestart(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined
): boolean {
  return ['agent', 'plugin', 'skills', 'provider'].some((field) => didConfigFieldChange(previous, next, field))
}

function hasConfiguredPlugins(config: Record<string, unknown> | undefined): boolean {
  return Array.isArray(config?.plugin) && config.plugin.length > 0
}

function execWithTimeout(
  command: string | [executable: string, ...args: string[]],
  timeoutMs: number,
  env?: Record<string, string>
): { output: string; timedOut: boolean } {
  if (Array.isArray(command)) {
    const result = spawnSync(command[0], command.slice(1), {
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      env: env ? { ...process.env, ...env } : undefined
    })

    if (result.signal === 'SIGKILL' || result.error?.message?.includes('TIMEOUT')) {
      return { output: '', timedOut: true }
    }

    const output = (result.stdout || '') + (result.stderr || '')
    return { output, timedOut: false }
  }

  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      env: env ? { ...process.env, ...env } : undefined
    })
    return { output, timedOut: false }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === null) {
      return { output: '', timedOut: true }
    }
    if (error && typeof error === 'object' && ('stdout' in error || 'stderr' in error)) {
      const stdout = (error as { stdout?: string }).stdout || ''
      const stderr = (error as { stderr?: string }).stderr || ''
      return { output: stdout + stderr, timedOut: false }
    }
    throw error
  }
}

const UpdateSettingsSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
})

const CreateOpenCodeConfigSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.union([OpenCodeConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
})

const UpdateOpenCodeConfigSchema = z.object({
  content: z.union([OpenCodeConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
})



const CreateCustomCommandSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(1000),
  promptTemplate: z.string().min(1).max(10000),
})

const UpdateCustomCommandSchema = z.object({
  description: z.string().min(1).max(1000),
  promptTemplate: z.string().min(1).max(10000),
})



const ConnectMcpDirectorySchema = z.object({
  directory: z.string().min(1),
})

const McpAuthDirectorySchema = ConnectMcpDirectorySchema

const DiscoverCalDavCalendarsSchema = z.object({
  serverUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
})

const IntegrationConfigRequestSchema = z.discriminatedUnion('type', [
  z.object({
    name: z.string().min(1),
    type: z.literal('mcp'),
    enabled: z.boolean(),
    serverUrl: z.string(),
    apiKey: z.string(),
  }),
  z.object({
    name: z.string().min(1),
    type: z.literal('caldav'),
    enabled: z.boolean(),
    serverUrl: z.string(),
    username: z.string(),
    password: z.string(),
    calendarUrl: z.string(),
  }),
  z.object({
    name: z.string().min(1),
    type: z.literal('mail'),
    enabled: z.boolean(),
    imapHost: z.string(),
    imapPort: z.number().int().min(1).max(65535),
    smtpHost: z.string(),
    smtpPort: z.number().int().min(1).max(65535),
    username: z.string(),
    password: z.string(),
    fromAddress: z.string(),
  }),
])

const SyncOpenCodeImportSchema = z.object({
  overwriteState: z.boolean().optional(),
})


async function extractOpenCodeError(response: Response, defaultError: string): Promise<string> {
  const errorObj = await response.json().catch(() => null)
  return (errorObj && typeof errorObj === 'object' && 'error' in errorObj)
    ? String(errorObj.error)
    : defaultError
}

function integrationToSettingsConfig(integration: Awaited<ReturnType<typeof listIntegrations>>[number]) {
  const type = toSettingsIntegrationType(integration.type)
  return {
    id: integration.id,
    name: integration.name,
    type,
    enabled: integration.enabled,
    ...integration.config,
  }
}

function settingsConfigToIntegrationData(config: z.infer<typeof IntegrationConfigRequestSchema>) {
  const { name, type, enabled, ...integrationConfig } = config
  return {
    name,
    type: normalizeIntegrationType(type),
    enabled,
    config: integrationConfig,
    metadata: {},
  }
}

export function createSettingsRoutes(db: Database, openCodeClient: OpenCodeClient, openCodeSupervisor?: OpenCodeSupervisor) {
  const app = new Hono()
  const settingsService = new SettingsService(db)

  app.get('/subpolar-tools', async (c) => {
    try {
      const tools = await listEnabledTools(db)
      return c.json({ tools })
    } catch (error) {
      logger.error('Failed to list Subpolar tools:', error)
      return c.json({ error: 'Failed to list Subpolar tools' }, 500)
    }
  })

  app.get('/agents/:agentId/tool-policies', async (c) => {
    try {
      const agentId = c.req.param('agentId')
      const policies = await listPoliciesForAgent(db, agentId)
      return c.json({ policies })
    } catch (error) {
      logger.error('Failed to list agent tool policies:', error)
      return c.json({ error: 'Failed to list agent tool policies' }, 500)
    }
  })

  app.put('/agents/:agentId/tool-policies', async (c) => {
    try {
      const agentId = c.req.param('agentId')
      const parsed = AgentToolPoliciesUpdateSchema.parse(await c.req.json())
      const policies = await replacePoliciesForAgent(db, agentId, parsed.policies.map(policy => ({
        tool_id: policy.toolId,
        effect: policy.effect,
        constraints: {},
      })))
      return c.json({ policies })
    } catch (error) {
      logger.error('Failed to update agent tool policies:', error)
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid agent tool policy data', details: error.issues }, 400)
      return c.json({ error: 'Failed to update agent tool policies' }, 500)
    }
  })

  app.get('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = await settingsService.getSettings(userId)
      return c.json(settings)
    } catch (error) {
      logger.error('Failed to get settings:', error)
      return c.json({ error: 'Failed to get settings' }, 500)
    }
  })

  app.patch('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = UpdateSettingsSchema.parse(body)

      const settings = settingsService.updateSettings(validated.preferences, userId)

      const serverRestarted = false

      return c.json({ ...settings, serverRestarted })
    } catch (error) {
      logger.error('Failed to update settings:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid settings data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update settings' }, 500)
    }
  })

  app.delete('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = settingsService.resetSettings(userId)
      return c.json(settings)
    } catch (error) {
      logger.error('Failed to reset settings:', error)
      return c.json({ error: 'Failed to reset settings' }, 500)
    }
  })

  app.get('/integrations', async (c) => {
    try {
      const integrations = await listIntegrations(db)
      return c.json({ integrations: integrations.map(integrationToSettingsConfig) })
    } catch (error) {
      logger.error('Failed to list integrations:', error)
      return c.json({ error: 'Failed to list integrations' }, 500)
    }
  })

  app.post('/integrations', async (c) => {
    try {
      const body = await c.req.json()
      const validated = IntegrationConfigRequestSchema.parse(body)
      const integration = await createIntegration(db, settingsConfigToIntegrationData(validated))
      return c.json(integrationToSettingsConfig(integration))
    } catch (error) {
      logger.error('Failed to create integration:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid integration data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to create integration' }, 500)
    }
  })

  app.put('/integrations/:id', async (c) => {
    try {
      const body = await c.req.json()
      const validated = IntegrationConfigRequestSchema.parse(body)
      const integration = await updateIntegration(db, c.req.param('id'), settingsConfigToIntegrationData(validated))
      return c.json(integrationToSettingsConfig(integration))
    } catch (error) {
      logger.error('Failed to update integration:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid integration data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update integration' }, 500)
    }
  })

  app.delete('/integrations/:id', async (c) => {
    try {
      await deleteIntegration(db, c.req.param('id'))
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete integration:', error)
      return c.json({ error: 'Failed to delete integration' }, 500)
    }
  })

  app.get('/calendar/upcoming', async (c) => {
    try {
      return c.json(await getUpcomingCalDavEvents(db))
    } catch (error) {
      logger.error('Failed to load upcoming calendar events:', error)
      return c.json({ error: error instanceof Error ? error.message : 'Failed to load upcoming calendar events' }, 500)
    }
  })

  // OpenCode Config routes
  app.get('/opencode-configs', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configs = await settingsService.getOpenCodeConfigs(userId)
      return c.json(configs)
    } catch (error) {
      logger.error('Failed to get PiInternal configs:', error)
      return c.json({ error: 'Failed to get OpenCode configs' }, 500)
    }
  })

  app.post('/opencode-configs', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = CreateOpenCodeConfigSchema.parse(body)

      if (validated.isDefault) {
        await settingsService.saveLastKnownGoodConfig(userId)

        const provisionalConfig = await settingsService.createOpenCodeConfig(
          { ...validated, isDefault: false },
          userId,
          { suppressAutoDefault: true }
        )

        if (hasConfiguredPlugins(provisionalConfig.content)) {
          const config = await settingsService.updateOpenCodeConfig(provisionalConfig.name, {
            content: provisionalConfig.rawContent,
            isDefault: true,
          }, userId)

          if (!config) {
            return c.json({ error: 'Failed to finalize OpenCode config creation' }, 500)
          }

          const configPath = getOpenCodeConfigFilePath()
          await writeFileContent(configPath, provisionalConfig.rawContent)
          logger.info(`Wrote default config to: ${configPath}`)
          opencodeServerManager.clearStartupError()
          await restartOpenCode(openCodeSupervisor)

          return c.json(config)
        }

        const patchResult = await patchConfigWithRecovery(openCodeClient, provisionalConfig.content)
        if (!patchResult.success) {
          await settingsService.deleteOpenCodeConfig(provisionalConfig.name, userId)
          return c.json({ 
            error: 'Config validation failed', 
            details: patchResult.error,
            validationIssues: patchResult.details,
            removedFields: patchResult.removedFields
          }, 400)
        }

        const contentToWrite = getOpenCodeConfigContentToWrite(
          provisionalConfig.rawContent,
          patchResult.appliedConfig,
          patchResult.removedFields
        )
        const config = await settingsService.updateOpenCodeConfig(provisionalConfig.name, {
          content: contentToWrite,
          isDefault: true,
        }, userId)

        if (!config) {
          return c.json({ error: 'Failed to finalize OpenCode config creation' }, 500)
        }

        const configPath = getOpenCodeConfigFilePath()
        await writeFileContent(configPath, contentToWrite)
        logger.info(`Wrote default config to: ${configPath}`)

        if (patchResult.removedFields && patchResult.removedFields.length > 0) {
          logger.info(`Config applied with auto-removed fields: ${patchResult.removedFields.join(', ')}`)
          return c.json({ ...config, removedFields: patchResult.removedFields })
        }

        return c.json(config)
      }

      const config = await settingsService.createOpenCodeConfig(validated, userId)
      return c.json(config)
    } catch (error) {
      logger.error('Failed to create PiInternal config:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        return c.json({ error: error.message }, 409)
      }
      return c.json({ error: 'Failed to create OpenCode config' }, 500)
    }
  })

  app.put('/opencode-configs/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      const body = await c.req.json()
      const validated = UpdateOpenCodeConfigSchema.parse(body)
      
      const existingConfig = await settingsService.getOpenCodeConfigByName(configName, userId)
      const previousContent = existingConfig?.content
      
      const config = await settingsService.updateOpenCodeConfig(configName, validated, userId)
      if (!config) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      if (config.isDefault) {
        const restartRequired = needsOpenCodeRestart(previousContent, config.content)
        const configPath = getOpenCodeConfigFilePath()

        if (restartRequired) {
          await writeFileContent(configPath, config.rawContent)
          logger.info(`Wrote default config to: ${configPath}`)
          logger.info('PiInternal configuration requires process restart')
          opencodeServerManager.clearStartupError()
          await restartOpenCode(openCodeSupervisor)
        } else {
          const patchResult = await patchConfigWithRecovery(openCodeClient, config.content)
          if (!patchResult.success) {
            return c.json({ 
              error: 'Config saved but failed to apply', 
              details: patchResult.error,
              validationIssues: patchResult.details,
              removedFields: patchResult.removedFields
            }, 500)
          }
          
          const contentToWrite = patchResult.removedFields && patchResult.removedFields.length > 0
            ? JSON.stringify(patchResult.appliedConfig ?? config.content, null, 2)
            : config.rawContent
          
          await writeFileContent(configPath, contentToWrite)
          logger.info(`Wrote default config to: ${configPath}`)
          
          if (patchResult.removedFields && patchResult.removedFields.length > 0) {
            logger.info(`Config applied with auto-removed fields: ${patchResult.removedFields.join(', ')}`)
            return c.json({ ...config, removedFields: patchResult.removedFields })
          }
        }
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to update PiInternal config:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode config' }, 500)
    }
  })

  app.delete('/opencode-configs/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      
      const deleted = await settingsService.deleteOpenCodeConfig(configName, userId)
      if (!deleted) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete PiInternal config:', error)
      return c.json({ error: 'Failed to delete OpenCode config' }, 500)
    }
  })

  app.post('/opencode-configs/:name/set-default', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')

      await settingsService.saveLastKnownGoodConfig(userId)

      const existingConfig = await settingsService.getOpenCodeConfigByName(configName, userId)
      if (!existingConfig) {
        return c.json({ error: 'Config not found' }, 404)
      }

      if (hasConfiguredPlugins(existingConfig.content)) {
        const config = await settingsService.setDefaultOpenCodeConfig(configName, userId)
        if (!config) {
          return c.json({ error: 'Config not found' }, 404)
        }

        const configPath = getOpenCodeConfigFilePath()
        await writeFileContent(configPath, existingConfig.rawContent)
        logger.info(`Wrote default config '${configName}' to: ${configPath}`)
        opencodeServerManager.clearStartupError()
        await restartOpenCode(openCodeSupervisor)

        return c.json(config)
      }

      const patchResult = await patchConfigWithRecovery(openCodeClient, existingConfig.content)
      if (!patchResult.success) {
        return c.json({ 
          error: 'Config validation failed', 
          details: patchResult.error,
          validationIssues: patchResult.details,
          removedFields: patchResult.removedFields
        }, 400)
      }

      const contentToWrite = getOpenCodeConfigContentToWrite(
        existingConfig.rawContent,
        patchResult.appliedConfig,
        patchResult.removedFields
      )
      const updatedConfig = await settingsService.updateOpenCodeConfig(configName, {
        content: contentToWrite,
      }, userId)

      if (!updatedConfig) {
        return c.json({ error: 'Failed to update OpenCode config' }, 500)
      }

      const config = await settingsService.setDefaultOpenCodeConfig(configName, userId)
      if (!config) {
        return c.json({ error: 'Config not found' }, 404)
      }

      const configPath = getOpenCodeConfigFilePath()
      await writeFileContent(configPath, contentToWrite)
      logger.info(`Wrote default config '${configName}' to: ${configPath}`)

      if (patchResult.removedFields && patchResult.removedFields.length > 0) {
        logger.info(`Config applied with auto-removed fields: ${patchResult.removedFields.join(', ')}`)
        return c.json({ ...config, removedFields: patchResult.removedFields })
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to set default PiInternal config:', error)
      return c.json({ error: 'Failed to set default OpenCode config' }, 500)
    }
  })

  app.get('/opencode-configs/default', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const config = await settingsService.getDefaultOpenCodeConfig(userId)
      
      if (!config) {
        return c.json({ error: 'No default config found' }, 404)
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to get default PiInternal config:', error)
      return c.json({ error: 'Failed to get default OpenCode config' }, 500)
    }
  })

  app.post('/opencode-restart', async (c) => {
    try {
      logger.info('Manual PiInternal server restart requested')
      opencodeServerManager.clearStartupError()
      await restartOpenCode(openCodeSupervisor)
      return c.json({ success: true, message: 'OpenCode server restarted successfully' })
    } catch (error) {
      logger.error('Failed to restart PiInternal server:', error)
      const startupError = opencodeServerManager.getLastStartupError()
      return c.json({
        error: 'Failed to restart OpenCode server',
        details: startupError || (error instanceof Error ? error.message : 'Unknown error')
      }, 500)
    }
  })

  app.get('/opencode-import/status', async (c) => {
    try {
      return c.json(await getOpenCodeImportStatus())
    } catch (error) {
      logger.error('Failed to get PiInternal import status:', error)
      return c.json({
        error: 'Failed to get OpenCode import status',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-import', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const rawBody = c.req.header('content-type')?.includes('application/json') ? await c.req.json() : {}
      const body = SyncOpenCodeImportSchema.parse(rawBody)
      const result = await syncOpenCodeImport({
        db,
        userId,
        overwriteState: body.overwriteState ?? false,
        protectExistingState: true,
      })

      if (!result.configImported && !result.stateImported) {
        return c.json({
          error: 'No importable OpenCode host data found',
          ...result,
        }, 404)
      }

      const relinkedRepos = {
        repos: [],
        relinkedCount: 0,
        existingCount: 0,
        nonRepoPathCount: 0,
        duplicatePathCount: 0,
        errors: [],
      }

      opencodeServerManager.clearStartupError()
      await restartOpenCode(openCodeSupervisor)

      return c.json({
        success: true,
        message: 'Imported existing OpenCode host data and restarted the server',
        serverRestarted: true,
        relinkedRepos,
        ...result,
      })
    } catch (error) {
      logger.error('Failed to import existing PiInternal host data:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid OpenCode import request', details: error.issues }, 400)
      }
      if (error instanceof OpenCodeImportProtectionError) {
        return c.json({
          error: error.message,
          code: error.code,
          detail: error.detail,
        }, 409)
      }
      return c.json({
        error: 'Failed to import existing OpenCode host data',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-reload', async (c) => {
    try {
      logger.info('PiInternal configuration reload requested')
      await reloadOpenCodeConfig(openCodeSupervisor)
      return c.json({ success: true, message: 'OpenCode configuration reloaded successfully' })
    } catch (error) {
      logger.error('Failed to reload PiInternal config:', error)
      if (error instanceof ConfigReloadError) {
        const details = error.validationIssues.length > 0
          ? error.validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
          : error.message
        return c.json({
          error: error.message,
          details,
          validationIssues: error.validationIssues,
          removedFields: error.removedFields
        }, 500)
      }
      return c.json({
        error: 'Failed to reload OpenCode configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-rollback', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      logger.info('PiInternal config rollback requested')

      const rollbackConfig = settingsService.rollbackToLastKnownGoodHealth(userId)
      if (!rollbackConfig) {
        return c.json({ error: 'No previous working config available for rollback' }, 404)
      }

      const configPath = getOpenCodeConfigFilePath()
      const config = await settingsService.getDefaultOpenCodeConfig(userId)
      if (!config) {
        return c.json({ error: 'Failed to get default config after rollback' }, 500)
      }

      await writeFileContent(configPath, config.rawContent)
      logger.info(`Rolled back to config '${rollbackConfig}'`)

      opencodeServerManager.clearStartupError()
      try {
        await reloadOpenCodeConfig(openCodeSupervisor)
      } catch (reloadError) {
        logger.error('Rollback config reload failed, attempting restart:', reloadError)

        const deleted = settingsService.deleteFilesystemConfig()
        if (deleted) {
          logger.info('Deleted filesystem config, attempting restart with fallback')
          await new Promise(r => setTimeout(r, 1000))

          opencodeServerManager.clearStartupError()
          await restartOpenCode(openCodeSupervisor)

          return c.json({
            success: true,
            message: `Server restarted after deleting problematic config. DB config '${rollbackConfig}' preserved for manual recovery.`,
            fallback: true,
            configName: rollbackConfig
          })
        }

        return c.json({
          error: 'Failed to rollback and could not delete filesystem config',
          details: reloadError instanceof Error ? reloadError.message : 'Unknown error'
        }, 500)
      }

      return c.json({
        success: true,
        message: `Server reloaded with previous working config: ${rollbackConfig}`,
        configName: rollbackConfig
      })
    } catch (error) {
      logger.error('Failed to rollback PiInternal config:', error)
      return c.json({ error: 'Failed to rollback OpenCode config' }, 500)
    }
  })

  app.post('/opencode-upgrade', async (c) => {
    const oldVersion = opencodeServerManager.getVersion()
    logger.info(`Current PiInternal version: ${oldVersion}`)

    try {
      const installMethod = getOpenCodeInstallMethod()
      logger.info(`Running PiInternal upgrade --method ${installMethod} with 90s timeout...`)
      const { output: upgradeOutput, timedOut } = execWithTimeout(`opencode upgrade --method ${installMethod} 2>&1`, 90000)
      logger.info(`Upgrade output: ${upgradeOutput}`)

      if (timedOut) {
        logger.warn('PiInternal upgrade timed out after 90 seconds')
        throw new Error('Upgrade command timed out after 90 seconds')
      }

      const newVersion = opencodeServerManager.getVersion() || await opencodeServerManager.fetchVersion()
      logger.info(`New PiInternal version: ${newVersion}`)

      const upgraded = oldVersion && newVersion && compareVersions(newVersion, oldVersion) > 0

      if (upgraded) {
        logger.info(`PiInternal upgraded from v${oldVersion} to v${newVersion}`)
        opencodeServerManager.clearStartupError()
        try {
          await reloadOpenCodeConfig(openCodeSupervisor)
          logger.info('PiInternal server reloaded after upgrade')
        } catch (reloadError) {
          logger.warn('Config reload after upgrade failed, attempting full restart:', reloadError)
          await restartOpenCode(openCodeSupervisor)
          logger.info('PiInternal server restarted after upgrade')
        }

        return c.json({
          success: true,
          message: `OpenCode upgraded from v${oldVersion} to v${newVersion} and configuration reloaded`,
          oldVersion,
          newVersion,
          upgraded: true
        })
      } else {
        logger.info('PiInternal is already up to date or version unchanged')
        return c.json({
          success: true,
          message: 'OpenCode is already up to date',
          oldVersion,
          newVersion,
          upgraded: false
        })
      }
    } catch (error) {
      logger.error('Failed to upgrade PiInternal:', error)
      logger.warn('Attempting to recover PiInternal server...')

      let recovered = false
      let recoveryMessage = ''

      opencodeServerManager.clearStartupError()
      try {
        await restartOpenCode(openCodeSupervisor)
        logger.warn('PiInternal server restarted after upgrade failure')
        recovered = true
        recoveryMessage = 'Server recovered'
      } catch (recoveryError) {
        logger.error('Failed to recover PiInternal server:', recoveryError)
        recovered = false
        recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown error'
      }

      let currentVersion: string | null | undefined = oldVersion
      try {
        currentVersion = opencodeServerManager.getVersion() || oldVersion
      } catch (versionError) {
        logger.error('Failed to get version after recovery:', versionError)
        currentVersion = oldVersion
      }

      return c.json(
        recovered ? {
          success: false,
          error: 'Upgrade failed but server recovered',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          upgraded: false,
          recovered: true,
          recoveryMessage
        } : {
          error: 'Failed to upgrade OpenCode and could not recover',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          upgraded: false,
          recovered: false,
          recoveryMessage
        },
        recovered ? 400 : 500
      )
    }
  })

  app.get('/opencode-versions', async (c) => {
    try {
      logger.info('Fetching available PiInternal versions from GitHub')
      
      const response = await fetch('https://api.github.com/repos/sst/opencode/releases?per_page=20', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'opencode-manager'
        }
      })
      
      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`)
      }
      
      const releases = await response.json() as Array<{
        tag_name: string
        name: string
        published_at: string
        prerelease: boolean
      }>
      
      const versions = releases
        .filter(r => !r.prerelease)
        .map(r => ({
          version: r.tag_name.replace(/^v/, ''),
          tag: r.tag_name,
          name: r.name,
          publishedAt: r.published_at
        }))
      
      const currentVersion = opencodeServerManager.getVersion()
      
      return c.json({
        versions,
        currentVersion
      })
    } catch (error) {
      logger.error('Failed to fetch PiInternal versions:', error)
      return c.json({
        error: 'Failed to fetch versions',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-install-version', async (c) => {
    const oldVersion = opencodeServerManager.getVersion()
    logger.info(`Current PiInternal version: ${oldVersion}`)

    try {
      const body = await c.req.json()
      const { version } = z.object({ version: z.string().min(1) }).parse(body)

      const versionWithoutPrefix = version.replace(/^v/, '')
      if (!isValidVersion(versionWithoutPrefix)) {
        throw new Error('Invalid version format. Must be in MAJOR.MINOR.PATCH format (e.g., 1.2.27)')
      }

      logger.info(`Installing PiInternal version: ${version}`)
      const versionArg = version.startsWith('v') ? version : `v${version}`
      const installMethod = getOpenCodeInstallMethod()
      logger.info(`Running PiInternal upgrade ${versionArg} --method ${installMethod} with 90s timeout...`)

      const { output: upgradeOutput, timedOut } = execWithTimeout(
        ['opencode', 'upgrade', versionArg, '--method', installMethod],
        90000
      )
      logger.info(`Upgrade output: ${upgradeOutput}`)

      if (timedOut) {
        logger.warn('PiInternal version install timed out after 90 seconds')
        throw new Error('Version install command timed out after 90 seconds')
      }

      const newVersion = await opencodeServerManager.fetchVersion()
      logger.info(`New PiInternal version: ${newVersion}`)

      opencodeServerManager.clearStartupError()
      await restartOpenCode(openCodeSupervisor)
      logger.info('PiInternal server restarted after version change')

      return c.json({
        success: true,
        message: `OpenCode ${oldVersion ? `changed from v${oldVersion} to` : 'installed as'} v${newVersion}`,
        oldVersion,
        newVersion
      })
    } catch (error) {
      logger.error('Failed to install PiInternal version:', error)
      logger.warn('Attempting to recover PiInternal server...')

      let recovered = false
      let recoveryMessage = ''

      opencodeServerManager.clearStartupError()
      try {
        await restartOpenCode(openCodeSupervisor)
        logger.warn('PiInternal server restarted after install failure')
        recovered = true
        recoveryMessage = 'Server recovered'
      } catch (recoveryError) {
        logger.error('Failed to recover PiInternal server:', recoveryError)
        recovered = false
        recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown error'
      }

      const currentVersion = opencodeServerManager.getVersion() || oldVersion

      return c.json(
        recovered ? {
          success: false,
          error: 'Version install failed but server recovered',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          recovered: true,
          recoveryMessage
        } : {
          error: 'Failed to install OpenCode version and could not recover',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          recovered: false,
          recoveryMessage
        },
        recovered ? 400 : 500
      )
    }
  })

  // Custom Commands routes
  app.get('/custom-commands', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = await settingsService.getSettings(userId)
      return c.json(settings.preferences.customCommands)
    } catch (error) {
      logger.error('Failed to get custom commands:', error)
      return c.json({ error: 'Failed to get custom commands' }, 500)
    }
  })

  app.post('/custom-commands', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = CreateCustomCommandSchema.parse(body)
      
      const settings = await settingsService.getSettings(userId)
      const existingCommand = settings.preferences.customCommands.find(cmd => cmd.name === validated.name)
      if (existingCommand) {
        return c.json({ error: 'Command with this name already exists' }, 409)
      }
      
      settingsService.updateSettings({
        customCommands: [...settings.preferences.customCommands, validated]
      }, userId)
      
      return c.json(validated)
    } catch (error) {
      logger.error('Failed to create custom command:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to create custom command' }, 500)
    }
  })

  app.put('/custom-commands/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const commandName = decodeURIComponent(c.req.param('name'))
      const body = await c.req.json()
      const validated = UpdateCustomCommandSchema.parse(body)
      
      const settings = await settingsService.getSettings(userId)
      const commandIndex = settings.preferences.customCommands.findIndex(cmd => cmd.name === commandName)
      if (commandIndex === -1) {
        return c.json({ error: 'Command not found' }, 404)
      }
      
      const updatedCommands = [...settings.preferences.customCommands]
      updatedCommands[commandIndex] = {
        name: commandName,
        description: validated.description,
        promptTemplate: validated.promptTemplate
      }
      
      settingsService.updateSettings({
        customCommands: updatedCommands
      }, userId)
      
      return c.json(updatedCommands[commandIndex])
    } catch (error) {
      logger.error('Failed to update custom command:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update custom command' }, 500)
    }
  })

  app.delete('/custom-commands/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const commandName = decodeURIComponent(c.req.param('name'))
      
      const settings = await settingsService.getSettings(userId)
      const commandExists = settings.preferences.customCommands.some(cmd => cmd.name === commandName)
      if (!commandExists) {
        return c.json({ error: 'Command not found' }, 404)
      }
      
      const updatedCommands = settings.preferences.customCommands.filter(cmd => cmd.name !== commandName)
      settingsService.updateSettings({
        customCommands: updatedCommands
      }, userId)
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete custom command:', error)
      return c.json({ error: 'Failed to delete custom command' }, 500)
    }
  })

  app.get('/agents-md', async (c) => {
    try {
      const agentsMdPath = getAgentsMdPath()
      const exists = await fileExists(agentsMdPath)
      
      if (!exists) {
        return c.json({ content: '' })
      }
      
      const content = await readFileContent(agentsMdPath)
      return c.json({ content })
    } catch (error) {
      logger.error('Failed to get AGENTS.md:', error)
      return c.json({ error: 'Failed to get AGENTS.md' }, 500)
    }
  })

  app.get('/agents-md/default', async (c) => {
    return c.json({ content: DEFAULT_AGENTS_MD })
  })

  app.put('/agents-md', async (c) => {
    try {
      const body = await c.req.json()
      const { content } = z.object({ content: z.string() }).parse(body)
      
      const agentsMdPath = getAgentsMdPath()
      await writeFileContent(agentsMdPath, content)
      logger.info(`Updated AGENTS.md at: ${agentsMdPath}`)
      
      await restartOpenCode(openCodeSupervisor)
      logger.info('Restarted PiInternal server after AGENTS.md update')
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to update AGENTS.md:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update AGENTS.md' }, 500)
    }
  })

  app.get('/skills', async (c) => {
    try {
      const repoIdParam = c.req.query('repoId')
      const repoId = repoIdParam ? parseInt(repoIdParam, 10) : undefined
      if (repoId !== undefined && isNaN(repoId)) {
        return c.json({ error: 'Invalid repoId' }, 400)
      }
      const directory = c.req.query('directory')
      
      const skills = await listManagedSkills(db, openCodeClient, repoId, directory)
      return c.json(skills)
    } catch (error) {
      logger.error('Failed to list skills:', error)
      return c.json({ error: 'Failed to list skills' }, 500)
    }
  })

  app.get('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoIdParam = c.req.query('repoId')
      const repoId = repoIdParam ? parseInt(repoIdParam, 10) : undefined
      if (repoId !== undefined && isNaN(repoId)) {
        return c.json({ error: 'Invalid repoId' }, 400)
      }

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      const skill = await getSkill(db, openCodeClient, name, scope, repoId)
      return c.json(skill)
    } catch (error) {
      logger.error('Failed to get skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid scope parameter. Must be "global" or "project"' }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to get skill' }, 500)
    }
  })

  app.post('/skills', async (c) => {
    try {
      const body = await c.req.json()
      const validated = CreateSkillRequestSchema.parse(body)

      const skill = await createSkill(db, validated)
      
      try {
        await restartOpenCode(openCodeSupervisor)
        logger.info('Restarted PiInternal server after skill creation')
      } catch (restartError) {
        logger.warn('Failed to restart PiInternal server after skill creation:', restartError)
      }
      
      return c.json(skill)
    } catch (error) {
      logger.error('Failed to create skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid skill data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        return c.json({ error: error.message }, 409)
      }
      return c.json({ error: 'Failed to create skill' }, 500)
    }
  })

  app.put('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoIdParam = c.req.query('repoId')
      const repoId = repoIdParam ? parseInt(repoIdParam, 10) : undefined
      if (repoId !== undefined && isNaN(repoId)) {
        return c.json({ error: 'Invalid repoId' }, 400)
      }
      const body = await c.req.json()
      const validated = UpdateSkillRequestSchema.parse(body)

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      const skill = await updateSkill(db, openCodeClient, name, scope, validated, repoId)
      
      try {
        await restartOpenCode(openCodeSupervisor)
        logger.info('Restarted PiInternal server after skill update')
      } catch (restartError) {
        logger.warn('Failed to restart PiInternal server after skill update:', restartError)
      }
      
      return c.json(skill)
    } catch (error) {
      logger.error('Failed to update skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to update skill' }, 500)
    }
  })

  app.delete('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoIdParam = c.req.query('repoId')
      const repoId = repoIdParam ? parseInt(repoIdParam, 10) : undefined
      if (repoId !== undefined && isNaN(repoId)) {
        return c.json({ error: 'Invalid repoId' }, 400)
      }

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      await deleteSkill(db, name, scope, repoId)
      
      try {
        await restartOpenCode(openCodeSupervisor)
        logger.info('Restarted PiInternal server after skill deletion')
      } catch (restartError) {
        logger.warn('Failed to restart PiInternal server after skill deletion:', restartError)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid scope parameter. Must be "global" or "project"' }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to delete skill' }, 500)
    }
  })

  // MCP directory-aware endpoints
  app.post('/mcp/:name/connectdirectory', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await (openCodeClient).forward({
        method: 'POST',
        path: `/mcp/${encodeURIComponent(serverName)}/connect`,
        directory,
      })
      
      if (!response.ok) {
        const errorMsg = await extractOpenCodeError(response, 'Failed to connect MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to connect MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to connect MCP server' }, 500)
    }
  })

  app.post('/mcp/:name/disconnectdirectory', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await (openCodeClient).forward({
        method: 'POST',
        path: `/mcp/${encodeURIComponent(serverName)}/disconnect`,
        directory,
      })
      
      if (!response.ok) {
        const errorMsg = await extractOpenCodeError(response, 'Failed to disconnect MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to disconnect MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to disconnect MCP server' }, 500)
    }
  })

  app.post('/mcp/:name/authdirectedir', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = McpAuthDirectorySchema.parse(body)
      
      const response = await (openCodeClient).forward({
        method: 'POST',
        path: `/mcp/${encodeURIComponent(serverName)}/auth/authenticate`,
        directory,
      })
      
      if (!response.ok) {
        const errorMsg = await extractOpenCodeError(response, 'Failed to authenticate MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json(await response.json())
    } catch (error) {
      logger.error('Failed to authenticate MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to authenticate MCP server' }, 500)
    }
  })

  app.delete('/mcp/:name/authdir', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await (openCodeClient).forward({
        method: 'DELETE',
        path: `/mcp/${encodeURIComponent(serverName)}/auth`,
        directory,
      })
      
      if (!response.ok) {
        const errorMsg = await extractOpenCodeError(response, 'Failed to remove MCP auth')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to remove MCP auth for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to remove MCP auth' }, 500)
    }
  })

  const OpenCodeServerAuthBodySchema = z.object({
    password: z.union([z.string().min(8), z.null()]),
  })

  app.get('/opencode-server-auth', async (c) => {
    try {
      const hasStored = await settingsService.hasStoredOpenCodeServerPassword()
      const source = hasStored ? 'db' : ENV.OPENCODE.SERVER_PASSWORD ? 'env' : 'none'
      const isSet = source !== 'none'
      return c.json({ isSet, source })
    } catch (error) {
      logger.error('Failed to get PiInternal server auth status:', error)
      return c.json({ error: 'Failed to get OpenCode server auth status' }, 500)
    }
  })

  app.patch('/opencode-server-auth', async (c) => {
    try {
      const body = await c.req.json()
      const validated = OpenCodeServerAuthBodySchema.parse(body)
      const previousPasswordState = await settingsService.getStoredOpenCodeServerPasswordState()

      if (validated.password === null) {
        await settingsService.clearOpenCodeServerPassword()
      } else if (validated.password) {
        await settingsService.setOpenCodeServerPassword(validated.password)
      }

      try {
        await opencodeServerManager.restart()
      } catch (restartError) {
        try {
          await settingsService.restoreOpenCodeServerPasswordState(previousPasswordState)
          await opencodeServerManager.restart()
          sseAggregator.reconnect()
        } catch (restoreError) {
          logger.error('Failed to restore PiInternal server auth runtime after restart failure:', restoreError)
        }
        throw restartError
      }

      sseAggregator.reconnect()

      const hasStored = await settingsService.hasStoredOpenCodeServerPassword()
      const source = hasStored ? 'db' : ENV.OPENCODE.SERVER_PASSWORD ? 'env' : 'none'
      const isSet = source !== 'none'
      return c.json({ isSet, source })
    } catch (error) {
      logger.error('Failed to update PiInternal server auth:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode server auth' }, 500)
    }
  })

  app.get('/manager-token', async (c) => {
    try {
      const token = getOrCreateInternalToken(db)
      return c.json({ token })
    } catch (error) {
      logger.error('Failed to get manager token:', error)
      return c.json({ error: 'Failed to get manager token' }, 500)
    }
  })

  app.post('/manager-token/rotate', async (c) => {
    try {
      const token = rotateInternalToken(db)
      return c.json({ token })
    } catch (error) {
      logger.error('Failed to rotate manager token:', error)
      return c.json({ error: 'Failed to rotate manager token' }, 500)
    }
  })

  app.post('/discover-caldav-calendars', async (c) => {
    try {
      const body = await c.req.json()
      const { serverUrl, username, password } = DiscoverCalDavCalendarsSchema.parse(body)
      const calendars = await discoverCalDavCalendars(serverUrl, username, password)

      return c.json({ calendars })
    } catch (error) {
      logger.error('Failed to discover CalDAV calendars:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Server URL, username, and password are required' }, 400)
      }
      return c.json({ error: error instanceof Error ? error.message : 'Failed to discover CalDAV calendars' }, 500)
    }
  })

  return app
}
