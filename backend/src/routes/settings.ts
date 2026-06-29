import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from '../db/schema'
import { SettingsService } from '../services/settings'
import { readFileContent, fileExists, writeFileContent } from '../services/file-operations'
import { getAgentsMdPath } from '@subpolar/shared/config/env'
import { UserPreferencesSchema } from '../types/settings'
import { CreateSkillRequestSchema, SkillScopeSchema, UpdateSkillRequestSchema } from '@subpolar/shared'
import { logger } from '../utils/logger'
import { DEFAULT_AGENTS_MD } from '../constants'
import { discoverCalDavCalendars, getUpcomingCalDavEvents } from '../services/caldav'
import { createSkill, deleteSkill, getSkill, listManagedSkills, updateSkill } from '../services/skills'
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

const UpdateSettingsSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
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

const DiscoverCalDavCalendarsSchema = z.object({
  serverUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
})

const IntegrationConfigRequestSchema = z.discriminatedUnion('type', [
  z.object({ name: z.string().min(1), type: z.literal('mcp'), enabled: z.boolean(), serverUrl: z.string(), apiKey: z.string() }),
  z.object({ name: z.string().min(1), type: z.literal('caldav'), enabled: z.boolean(), serverUrl: z.string(), username: z.string(), password: z.string(), calendarUrl: z.string() }),
  z.object({ name: z.string().min(1), type: z.literal('mail'), enabled: z.boolean(), imapHost: z.string(), imapPort: z.number().int().min(1).max(65535), smtpHost: z.string(), smtpPort: z.number().int().min(1).max(65535), username: z.string(), password: z.string(), fromAddress: z.string() }),
])

function integrationToSettingsConfig(integration: Awaited<ReturnType<typeof listIntegrations>>[number]) {
  return {
    id: integration.id,
    name: integration.name,
    type: toSettingsIntegrationType(integration.type),
    enabled: integration.enabled,
    ...integration.config,
  }
}

function settingsConfigToIntegrationData(config: z.infer<typeof IntegrationConfigRequestSchema>) {
  const { name, type, enabled, ...integrationConfig } = config
  return { name, type: normalizeIntegrationType(type), enabled, config: integrationConfig, metadata: {} }
}

export function createSettingsRoutes(db: Database) {
  const app = new Hono()
  const settingsService = new SettingsService(db)

  app.get('/subpolar-tools', async (c) => c.json({ tools: await listEnabledTools(db) }))

  app.get('/agents/:agentId/tool-policies', async (c) => {
    const policies = await listPoliciesForAgent(db, c.req.param('agentId'))
    return c.json({ policies })
  })

  app.put('/agents/:agentId/tool-policies', async (c) => {
    try {
      const parsed = AgentToolPoliciesUpdateSchema.parse(await c.req.json())
      const policies = await replacePoliciesForAgent(db, c.req.param('agentId'), parsed.policies.map((policy) => ({
        tool_id: policy.toolId,
        effect: policy.effect,
        constraints: {},
      })))
      return c.json({ policies })
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid agent tool policy data', details: error.issues }, 400)
      logger.error('Failed to update agent tool policies:', error)
      return c.json({ error: 'Failed to update agent tool policies' }, 500)
    }
  })

  app.get('/', async (c) => c.json(await settingsService.getSettings(c.req.query('userId') || 'default')))

  app.patch('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const validated = UpdateSettingsSchema.parse(await c.req.json())
      const settings = settingsService.updateSettings(validated.preferences, userId)
      return c.json({ ...settings, serverRestarted: false })
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid settings data', details: error.issues }, 400)
      logger.error('Failed to update settings:', error)
      return c.json({ error: 'Failed to update settings' }, 500)
    }
  })

  app.delete('/', async (c) => c.json(settingsService.resetSettings(c.req.query('userId') || 'default')))

  app.get('/integrations', async (c) => c.json({ integrations: (await listIntegrations(db)).map(integrationToSettingsConfig) }))

  app.post('/integrations', async (c) => {
    try {
      const validated = IntegrationConfigRequestSchema.parse(await c.req.json())
      const integration = await createIntegration(db, settingsConfigToIntegrationData(validated))
      return c.json(integrationToSettingsConfig(integration))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid integration data', details: error.issues }, 400)
      logger.error('Failed to create integration:', error)
      return c.json({ error: 'Failed to create integration' }, 500)
    }
  })

  app.put('/integrations/:id', async (c) => {
    try {
      const validated = IntegrationConfigRequestSchema.parse(await c.req.json())
      const integration = await updateIntegration(db, c.req.param('id'), settingsConfigToIntegrationData(validated))
      return c.json(integrationToSettingsConfig(integration))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid integration data', details: error.issues }, 400)
      logger.error('Failed to update integration:', error)
      return c.json({ error: 'Failed to update integration' }, 500)
    }
  })

  app.delete('/integrations/:id', async (c) => {
    await deleteIntegration(db, c.req.param('id'))
    return c.json({ success: true })
  })

  app.get('/calendar/upcoming', async (c) => c.json(await getUpcomingCalDavEvents(db)))

  app.post('/calendar/discover', async (c) => {
    try {
      return c.json(await discoverCalDavCalendars(db, DiscoverCalDavCalendarsSchema.parse(await c.req.json())))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid CalDAV data', details: error.issues }, 400)
      logger.error('Failed to discover CalDAV calendars:', error)
      return c.json({ error: 'Failed to discover calendars' }, 500)
    }
  })

  app.get('/custom-commands', async (c) => c.json((await settingsService.getSettings(c.req.query('userId') || 'default')).preferences.customCommands))

  app.post('/custom-commands', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const validated = CreateCustomCommandSchema.parse(await c.req.json())
      const settings = await settingsService.getSettings(userId)
      if (settings.preferences.customCommands.some((cmd) => cmd.name === validated.name)) return c.json({ error: 'Command with this name already exists' }, 409)
      settingsService.updateSettings({ customCommands: [...settings.preferences.customCommands, validated] }, userId)
      return c.json(validated)
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      logger.error('Failed to create custom command:', error)
      return c.json({ error: 'Failed to create custom command' }, 500)
    }
  })

  app.put('/custom-commands/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const commandName = decodeURIComponent(c.req.param('name'))
      const validated = UpdateCustomCommandSchema.parse(await c.req.json())
      const settings = await settingsService.getSettings(userId)
      const commandIndex = settings.preferences.customCommands.findIndex((cmd) => cmd.name === commandName)
      if (commandIndex === -1) return c.json({ error: 'Command not found' }, 404)
      const customCommands = [...settings.preferences.customCommands]
      customCommands[commandIndex] = { name: commandName, ...validated }
      settingsService.updateSettings({ customCommands }, userId)
      return c.json(customCommands[commandIndex])
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      logger.error('Failed to update custom command:', error)
      return c.json({ error: 'Failed to update custom command' }, 500)
    }
  })

  app.delete('/custom-commands/:name', async (c) => {
    const userId = c.req.query('userId') || 'default'
    const commandName = decodeURIComponent(c.req.param('name'))
    const settings = await settingsService.getSettings(userId)
    settingsService.updateSettings({ customCommands: settings.preferences.customCommands.filter((cmd) => cmd.name !== commandName) }, userId)
    return c.json({ success: true })
  })

  app.get('/agents-md', async (c) => c.json({ content: await fileExists(getAgentsMdPath()) ? await readFileContent(getAgentsMdPath()) : '' }))
  app.get('/agents-md/default', async (c) => c.json({ content: DEFAULT_AGENTS_MD }))
  app.put('/agents-md', async (c) => {
    const { content } = z.object({ content: z.string() }).parse(await c.req.json())
    await writeFileContent(getAgentsMdPath(), content)
    return c.json({ success: true })
  })

  app.get('/skills', async (c) => {
    const repoIdParam = c.req.query('repoId')
    const repoId = repoIdParam ? parseInt(repoIdParam, 10) : undefined
    if (repoId !== undefined && Number.isNaN(repoId)) return c.json({ error: 'Invalid repoId' }, 400)
    return c.json(await listManagedSkills(db, repoId, c.req.query('directory')))
  })

  app.get('/skills/:name', async (c) => {
    try {
      const repoIdParam = c.req.query('repoId')
      const repoId = repoIdParam ? parseInt(repoIdParam, 10) : undefined
      return c.json(await getSkill(db, c.req.param('name'), SkillScopeSchema.parse(c.req.query('scope')), repoId))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid scope parameter. Must be "global" or "project"' }, 400)
      if (error instanceof Error && error.message.includes('not found')) return c.json({ error: error.message }, 404)
      logger.error('Failed to get skill:', error)
      return c.json({ error: 'Failed to get skill' }, 500)
    }
  })

  app.post('/skills', async (c) => c.json(await createSkill(db, CreateSkillRequestSchema.parse(await c.req.json()))))

  app.put('/skills/:name', async (c) => {
    const repoIdParam = c.req.query('repoId')
    const repoId = repoIdParam ? parseInt(repoIdParam, 10) : undefined
    return c.json(await updateSkill(db, c.req.param('name'), SkillScopeSchema.parse(c.req.query('scope')), UpdateSkillRequestSchema.parse(await c.req.json()), repoId))
  })

  app.delete('/skills/:name', async (c) => {
    const repoIdParam = c.req.query('repoId')
    const repoId = repoIdParam ? parseInt(repoIdParam, 10) : undefined
    await deleteSkill(db, c.req.param('name'), SkillScopeSchema.parse(c.req.query('scope')), repoId)
    return c.json({ success: true })
  })

  app.get('/internal-token', async (c) => c.json({ token: null }))
  app.post('/internal-token/rotate', async (c) => c.json({ token: null }))

  return app
}
