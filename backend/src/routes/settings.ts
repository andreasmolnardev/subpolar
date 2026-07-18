import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from '../db/schema'
import { SettingsService } from '../services/settings'
import { readFileContent, fileExists, writeFileContent } from '../services/file-operations'
import { getAgentsMdPath } from '@subpolar/shared/config/env'
import { UserPreferencesSchema } from '../types/settings'
import {
  CreatePiConfigRequestSchema,
  CreateSkillRequestSchema,
  SkillScopeSchema,
  UpdatePiConfigRequestSchema,
  UpdateSkillRequestSchema,
} from '@subpolar/shared'
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
import { closeMcpSession, discoverConfiguredMcpTools, discoverMcpTools, saveMcpSecrets } from '../services/mcp'
import { discoverOpenApiDocument, discoverOpenApiTools, normalizeProviderName, saveOpenApiSecrets } from '../services/openapi'

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
  z.object({ name: z.string().min(1), type: z.literal('mcp'), enabled: z.boolean(), transport: z.enum(['stdio', 'streamable-http']), command: z.array(z.string().min(1)).optional(), cwd: z.string().optional(), environment: z.record(z.string(), z.string()).optional(), serverUrl: z.union([z.string().url(), z.literal('')]).optional(), headers: z.record(z.string(), z.string()).optional(), timeout: z.number().int().min(1000).max(120000).optional(), environmentKeys: z.array(z.string()).optional(), headerNames: z.array(z.string()).optional() }),
  z.object({ name: z.string().min(1), type: z.literal('openapi'), enabled: z.boolean(), providerName: z.string().min(1), document: z.string().min(2), serverUrl: z.union([z.string().url(), z.literal('')]).optional(), timeout: z.number().int().min(1000).max(120000).optional(), authType: z.enum(['spec', 'none', 'apiKey', 'bearer', 'basic', 'headers']).optional(), authKeyName: z.string().optional(), authPlacement: z.enum(['header', 'query', 'cookie']).optional(), authValue: z.string().optional(), authUsername: z.string().optional(), authPassword: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), headerNames: z.array(z.string()).optional() }),
  z.object({ name: z.string().min(1), type: z.literal('caldav'), enabled: z.boolean(), serverUrl: z.string(), username: z.string(), password: z.string(), calendarUrl: z.string() }),
  z.object({ name: z.string().min(1), type: z.literal('mail'), enabled: z.boolean(), imapHost: z.string(), imapPort: z.number().int().min(1).max(65535), smtpHost: z.string(), smtpPort: z.number().int().min(1).max(65535), username: z.string(), password: z.string(), fromAddress: z.string() }),
])

const McpServerRequestSchema = z.object({
  name: z.string().min(1).max(120),
  config: z.object({
    type: z.enum(['local', 'remote']).optional(),
    transport: z.enum(['stdio', 'streamable-http']).optional(),
    command: z.array(z.string().min(1)).optional(),
    cwd: z.string().optional(),
    environment: z.record(z.string(), z.string()).optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().int().min(1000).max(120000).optional(),
    enabled: z.boolean().optional(),
  }),
})

function toMcpConfig(config: z.infer<typeof McpServerRequestSchema>['config']) {
  const transport = config.transport ?? (config.type === 'local' ? 'stdio' : 'streamable-http')
  if (transport === 'stdio' && !config.command?.length) throw new Error('command is required for local MCP servers')
  if (transport === 'streamable-http' && !config.url) throw new Error('url is required for remote MCP servers')
  return { transport, command: config.command, cwd: config.cwd, url: config.url, timeout: config.timeout }
}

function integrationToSettingsConfig(integration: Awaited<ReturnType<typeof listIntegrations>>[number]) {
  const config = integration.type === 'mcp'
    ? (() => {
        const { environment, headers, ...safeConfig } = integration.config
        const environmentKeys = Array.isArray(integration.metadata.environmentKeys) ? integration.metadata.environmentKeys.filter((key): key is string => typeof key === 'string') : Object.keys(environment && typeof environment === 'object' ? environment : {})
        const headerNames = Array.isArray(integration.metadata.headerNames) ? integration.metadata.headerNames.filter((key): key is string => typeof key === 'string') : Object.keys(headers && typeof headers === 'object' ? headers : {})
        return {
          ...safeConfig,
          serverUrl: typeof safeConfig.url === 'string' ? safeConfig.url : undefined,
          url: undefined,
          hasEnvironment: environmentKeys.length > 0,
          environmentKeys,
          hasHeaders: headerNames.length > 0,
          headerNames,
        }
      })()
    : integration.type === 'openapi'
      ? (() => {
          const { document, ...config } = integration.config
          return { ...config, document: typeof document === 'string' ? document : '', headerNames: integration.metadata.headerNames ?? [], hasAuth: integration.metadata.hasAuth === true, toolCount: Number(integration.metadata.toolCount ?? 0), discoveryError: typeof integration.metadata.error === 'string' ? integration.metadata.error : undefined }
        })()
      : integration.config
  return {
    id: integration.id,
    name: integration.name,
    type: toSettingsIntegrationType(integration.type),
    enabled: integration.enabled,
    ...config,
  }
}

type IntegrationSaveData = Parameters<typeof createIntegration>[1] & { secrets?: { environment?: Record<string, string>; headers?: Record<string, string>; authValue?: string; authUsername?: string; authPassword?: string } }

function settingsConfigToIntegrationData(config: z.infer<typeof IntegrationConfigRequestSchema>): IntegrationSaveData {
  if (config.type === 'mcp') {
    const mcp = config as { name: string; enabled: boolean; transport: 'stdio' | 'streamable-http'; command?: string[]; cwd?: string; environment?: Record<string, string>; serverUrl?: string; headers?: Record<string, string>; timeout?: number; environmentKeys?: string[]; headerNames?: string[] }
    return {
      name: mcp.name,
      type: 'mcp' as const,
      enabled: mcp.enabled,
      config: { transport: mcp.transport, command: mcp.command, cwd: mcp.cwd || undefined, url: mcp.serverUrl || undefined, timeout: mcp.timeout },
      metadata: { environmentKeys: mcp.environmentKeys ?? Object.keys(mcp.environment ?? {}), headerNames: mcp.headerNames ?? Object.keys(mcp.headers ?? {}) },
      secrets: { environment: mcp.environment, headers: mcp.headers },
    }
  }
  if (config.type === 'openapi') {
    const openapi = config
    const providerName = normalizeProviderName(openapi.providerName)
    discoverOpenApiDocument({ providerName, document: openapi.document, serverUrl: openapi.serverUrl || undefined, timeout: openapi.timeout, authType: openapi.authType, authKeyName: openapi.authKeyName, authPlacement: openapi.authPlacement })
    return { name: openapi.name, type: 'openapi', enabled: openapi.enabled, config: { providerName, document: openapi.document, serverUrl: openapi.serverUrl || undefined, timeout: openapi.timeout, authType: openapi.authType ?? 'spec', authKeyName: openapi.authKeyName, authPlacement: openapi.authPlacement }, metadata: { headerNames: openapi.headerNames ?? Object.keys(openapi.headers ?? {}), hasAuth: Boolean(openapi.authValue || openapi.authUsername || openapi.authPassword) }, secrets: { authValue: openapi.authValue, authUsername: openapi.authUsername, authPassword: openapi.authPassword, headers: openapi.headers } }
  }
  const { name, type, enabled, ...integrationConfig } = config
  return { name, type: normalizeIntegrationType(type), enabled, config: integrationConfig, metadata: {} }
}

async function resolveMcpServerId(db: Database, idOrName: string): Promise<string | null> {
  const server = (await listIntegrations(db)).find(integration => integration.type === 'mcp' && (integration.id === idOrName || integration.name === idOrName))
  return server?.id ?? null
}

export function createSettingsRoutes(db: Database) {
  const app = new Hono()
  const settingsService = new SettingsService(db)

  app.get('/subpolar-tools', async (c) => c.json({ tools: await listEnabledTools(db) }))

  app.post('/openapi/discover', async (c) => {
    try {
      const parsed = IntegrationConfigRequestSchema.parse(await c.req.json())
      if (parsed.type !== 'openapi') return c.json({ error: 'OpenAPI integration data is required' }, 400)
      const providerName = normalizeProviderName(parsed.providerName)
      const tools = discoverOpenApiDocument({ providerName, document: parsed.document, serverUrl: parsed.serverUrl || undefined, timeout: parsed.timeout, authType: parsed.authType, authKeyName: parsed.authKeyName, authPlacement: parsed.authPlacement })
      return c.json({ providerName, tools: tools.map(tool => ({ toolId: tool.toolId, method: tool.method, path: tool.path, description: tool.description })) })
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'OpenAPI discovery failed' }, 400) }
  })

  app.post('/openapi/:id/refresh', async (c) => {
    try {
      const tools = await discoverOpenApiTools(db, c.req.param('id'))
      return c.json({ toolCount: tools.length })
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'OpenAPI discovery failed' }, 400) }
  })

  app.get('/mcp', async (c) => {
    const servers = (await listIntegrations(db)).filter(integration => integration.type === 'mcp')
    return c.json(Object.fromEntries(servers.map(server => [server.id, {
      status: server.enabled && Number(server.metadata.toolCount ?? 0) > 0 ? 'connected' : 'disabled',
      name: server.name,
      enabled: server.enabled,
      transport: server.config.transport,
      toolCount: Number(server.metadata.toolCount ?? 0),
      error: typeof server.metadata.error === 'string' ? server.metadata.error : undefined,
    }])))
  })

  app.post('/mcp', async (c) => {
    try {
      const parsed = McpServerRequestSchema.parse(await c.req.json())
      const config = toMcpConfig(parsed.config)
      const server = await createIntegration(db, {
        name: parsed.name,
        type: 'mcp',
        enabled: parsed.config.enabled ?? true,
        config,
        metadata: {
          environmentKeys: Object.keys(parsed.config.environment ?? {}),
          headerNames: Object.keys(parsed.config.headers ?? {}),
        },
      })
      await saveMcpSecrets(db, server.id, { environment: parsed.config.environment, headers: parsed.config.headers })
      if (server.enabled) await discoverConfiguredMcpTools(db)
      return c.json({ [server.id]: { status: 'disabled', name: server.name, enabled: server.enabled } })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid MCP server configuration' }, 400)
    }
  })

  app.delete('/mcp/:id', async (c) => {
    const id = await resolveMcpServerId(db, c.req.param('id'))
    if (!id) return c.json({ error: 'MCP server not found' }, 404)
    await deleteIntegration(db, id)
    return c.json({ success: true })
  })

  app.post('/mcp/:id/connect', async (c) => {
    const id = await resolveMcpServerId(db, c.req.param('id'))
    if (!id) return c.json(false, 404)
    const server = await updateIntegration(db, id, { enabled: true })
    try {
      const tools = await discoverMcpTools(db, server.id)
      await updateIntegration(db, server.id, { metadata: { ...server.metadata, toolCount: tools.length, error: '' } })
      return c.json(true)
    } catch (error) {
      await updateIntegration(db, server.id, { metadata: { ...server.metadata, error: error instanceof Error ? error.message : 'MCP connection failed' } })
      return c.json(false, 502)
    }
  })

  app.post('/mcp/:id/disconnect', async (c) => {
    const id = await resolveMcpServerId(db, c.req.param('id'))
    if (!id) return c.json(false, 404)
    await updateIntegration(db, id, { enabled: false })
    closeMcpSession('discovery')
    return c.json(true)
  })

  app.post('/mcp/:id/refresh', async (c) => {
    const id = await resolveMcpServerId(db, c.req.param('id'))
    if (!id) return c.json({ error: 'MCP server not found' }, 404)
    const current = (await listIntegrations(db)).find(integration => integration.id === id)
    try {
      const tools = await discoverMcpTools(db, id)
      const server = await updateIntegration(db, id, { metadata: { ...current?.metadata, toolCount: tools.length, error: '' } })
      return c.json({ serverId: server.id, toolCount: tools.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP discovery failed'
      await updateIntegration(db, id, { metadata: { ...current?.metadata, error: message } })
      return c.json({ error: 'MCP discovery failed' }, 502)
    }
  })

  app.get('/pi-settings', async (c) => {
    return c.json(await settingsService.getOpenCodeConfigs(c.req.query('userId') || 'default'))
  })

  app.get('/pi-settings/default', async (c) => {
    return c.json(await settingsService.getDefaultOpenCodeConfig(c.req.query('userId') || 'default'))
  })

  app.post('/pi-settings', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const request = CreatePiConfigRequestSchema.parse(await c.req.json())
      return c.json(await settingsService.createOpenCodeConfig(request, userId))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid Pi config data', details: error.issues }, 400)
      logger.error('Failed to create Pi config:', error)
      return c.json({ error: error instanceof Error ? error.message : 'Failed to create Pi config' }, 400)
    }
  })

  app.put('/pi-settings/:configName', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const request = UpdatePiConfigRequestSchema.parse(await c.req.json())
      const config = await settingsService.updateOpenCodeConfig(decodeURIComponent(c.req.param('configName')), request, userId)
      if (!config) return c.json({ error: 'Pi config not found' }, 404)
      return c.json(config)
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid Pi config data', details: error.issues }, 400)
      logger.error('Failed to update Pi config:', error)
      return c.json({ error: error instanceof Error ? error.message : 'Failed to update Pi config' }, 400)
    }
  })

  app.delete('/pi-settings/:configName', async (c) => {
    const deleted = await settingsService.deleteOpenCodeConfig(decodeURIComponent(c.req.param('configName')), c.req.query('userId') || 'default')
    if (!deleted) return c.json({ error: 'Pi config not found' }, 404)
    return c.json({ success: true })
  })

  app.post('/pi-settings/:configName/set-default', async (c) => {
    const config = await settingsService.setDefaultOpenCodeConfig(decodeURIComponent(c.req.param('configName')), c.req.query('userId') || 'default')
    if (!config) return c.json({ error: 'Pi config not found' }, 404)
    return c.json(config)
  })

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
      const data = settingsConfigToIntegrationData(validated)
      const integration = await createIntegration(db, data)
      if (integration.type === 'mcp' && data.secrets) await saveMcpSecrets(db, integration.id, data.secrets)
      if (integration.type === 'mcp' && integration.enabled) await discoverConfiguredMcpTools(db)
      if (integration.type === 'openapi' && data.secrets) await saveOpenApiSecrets(db, integration.id, data.secrets)
      if (integration.type === 'openapi' && integration.enabled) await discoverOpenApiTools(db, integration.id)
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
      const data = settingsConfigToIntegrationData(validated)
      const integration = await updateIntegration(db, c.req.param('id'), data)
      if (integration.type === 'mcp' && data.secrets && (Object.keys(data.secrets.environment ?? {}).length > 0 || Object.keys(data.secrets.headers ?? {}).length > 0)) await saveMcpSecrets(db, integration.id, data.secrets)
      if (integration.type === 'mcp' && integration.enabled) await discoverConfiguredMcpTools(db)
      if (integration.type === 'openapi' && data.secrets) await saveOpenApiSecrets(db, integration.id, data.secrets)
      if (integration.type === 'openapi' && integration.enabled) await discoverOpenApiTools(db, integration.id)
      return c.json(integrationToSettingsConfig(integration))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid integration data', details: error.issues }, 400)
      logger.error('Failed to update integration:', error)
      return c.json({ error: 'Failed to update integration' }, 500)
    }
  })

  app.delete('/integrations/:id', async (c) => {
    const id = c.req.param('id')
    const integration = (await listIntegrations(db)).find(item => item.id === id)
    if (integration?.type === 'openapi') {
      const tools = await db.collection('tool_registry').getFullList({ filter: `namespace = "openapi" && target = "${id.replaceAll('"', '\\"')}"` })
      for (const tool of tools) await db.collection('tool_registry').delete(String(tool.id))
      const secret = await db.collection('openapi_secrets').getFirstListItem(`server_id = "${id.replaceAll('"', '\\"')}"`).catch(() => null)
      if (secret) await db.collection('openapi_secrets').delete(String((secret as unknown as { id: string }).id))
    }
    await deleteIntegration(db, id)
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
