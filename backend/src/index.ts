import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'fs/promises'
import { initializeDatabase, type Database } from './db/schema'
import { createSettingsRoutes } from './routes/settings'
import { createHealthRoutes } from './routes/health'
import { createTTSRoutes, cleanupExpiredCache } from './routes/tts';
import { createSTTRoutes } from './routes/stt'
import { createFileRoutes } from './routes/files'
import { createAutomationRoutes } from './routes/automations'

async function getAppVersion(): Promise<string> {
  try {
    const packageUrl = new URL('../../package.json', import.meta.url)
    const packageJsonRaw = await readFile(packageUrl, 'utf-8')
    const packageJson = JSON.parse(packageJsonRaw) as { version?: string }
    return packageJson.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
import { createProvidersRoutes } from './routes/providers'
import { createOAuthRoutes } from './routes/oauth'
import { createSSERoutes } from './routes/sse'
import { createNotificationRoutes } from './routes/notifications'
import { createMcpOauthProxyRoutes } from './routes/mcp-oauth-proxy'
import { createAuthRoutes, createAuthInfoRoutes } from './routes/auth'
import { createAuthMiddleware } from './auth/middleware'
import { createPromptTemplateRoutes } from './routes/prompt-templates'
import { createProjectRoutes } from './routes/projects'
import { createSessionRoutes } from './routes/sessions'
import { createInternalRoutes } from './routes/internal'
import { createOpenCodeProxyRoutes } from './routes/opencode-proxy'
import { sseAggregator } from './services/sse-aggregator'
import { ensureDirectoryExists, writeFileContent, fileExists, readFileContent } from './services/file-operations'
import { SettingsService } from './services/settings'
import { opencodeServerManager } from './services/opencode-single-server'
import { createOpenCodeClient } from './services/opencode/client'
import { NotificationService } from './services/notification'
import { AutomationRunner, AutomationService } from './services/automations'
import { migrateGlobalSkills } from './services/skills'
import { ensureGeneralChatProject } from './db/projects'
import { deleteSessionRecord, upsertSessionRecord } from './db/sessions'
import { installAssistantWorkspace } from './services/general-chat'
import { getOpenCodeImportStatus, syncOpenCodeImport } from './services/opencode-import'
import { OpenCodeSupervisor } from './services/opencode-supervisor'
import { OpenCodeConfigSchema } from '@subpolar/shared/schemas'
import { parse as parseJsonc } from 'jsonc-parser'
import { getModelStatePath, ModelStateSchema } from './routes/providers'
import { readJsonSafe } from './utils/atomic-json'
import {
  type OpenCodeModelStateRecord,
  getOpenCodeModelState,
  addRecentOpenCodeModel,
  toggleFavoriteOpenCodeModel,
} from './db/model-state'

import { logger } from './utils/logger'
import { 
  getWorkspacePath, 
  getConfigPath,
  getOpenCodeConfigFilePath,
  getAgentsMdPath,
  ENV
} from '@subpolar/shared/config/env'


const { PORT, HOST } = ENV.SERVER

const app = new Hono()

app.use('/*', async (c, next) => {
  const startedAt = performance.now()
  const requestId = crypto.randomUUID()
  const url = new URL(c.req.url)
  const target = `${url.pathname}${url.search}`
  const origin = c.req.header('origin') ?? '-'
  const userAgent = c.req.header('user-agent') ?? '-'

  c.header('x-request-id', requestId)
  logger.info(`Request ${requestId} -> ${c.req.method} ${target} origin=${origin} userAgent="${userAgent}"`)

  try {
    await next()
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt)
    logger.error(`Request ${requestId} !! ${c.req.method} ${target} failed after ${durationMs}ms`, error)
    throw error
  }

  const durationMs = Math.round(performance.now() - startedAt)
  const level = c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info'
  logger[level](`Request ${requestId} <- ${c.req.method} ${target} ${c.res.status} ${durationMs}ms`)
})

app.use('/*', cors({
  origin: (origin) => {
    const trustedOrigins = ENV.AUTH.TRUSTED_ORIGINS.split(',').map(o => o.trim())
    if (!origin) return trustedOrigins[0]
    if (trustedOrigins.includes(origin)) return origin
    return trustedOrigins[0]
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

// Initialize database (now async to support PocketBase)
let db: Database | undefined
let requireAuth: ReturnType<typeof createAuthMiddleware> | undefined
let openCodeClient: ReturnType<typeof createOpenCodeClient> | undefined
let automationService: AutomationService | undefined
let automationRunnerInstance: AutomationRunner | undefined
let notificationService: NotificationService | undefined
let settingsService: SettingsService | undefined

async function initializeApp() {
  db = await initializeDatabase()
  await ensureGeneralChatProject(db!).catch((err) => logger.warn('Failed to ensure general chat project:', err))
  requireAuth = createAuthMiddleware()
  openCodeClient = createOpenCodeClient(async () => new SettingsService(db!).getOpenCodeServerPassword())
  opencodeServerManager.setOpenCodeClient(openCodeClient)
}

import { DEFAULT_AGENTS_MD } from './constants'

let openCodeSupervisor: OpenCodeSupervisor | undefined
async function ensureDefaultConfigExists(): Promise<void> {
  const ss = new SettingsService(db!)
  const workspaceConfigPath = getOpenCodeConfigFilePath()

  if (await fileExists(workspaceConfigPath)) {
    logger.info(`Found workspace config at ${workspaceConfigPath}, syncing to database...`)
    try {
      const rawContent = await readFileContent(workspaceConfigPath)
      const parsed = parseJsonc(rawContent)
      const validation = OpenCodeConfigSchema.safeParse(parsed)

      if (!validation.success) {
        logger.warn('Workspace config has invalid structure', validation.error)
      } else {
        const existingDefault = await ss.getOpenCodeConfigByName('default')
        if (existingDefault) {
          await ss.updateOpenCodeConfig('default', {
            content: rawContent,
            isDefault: true,
          })
          logger.info('Updated database config from workspace file')
        } else {
          await ss.createOpenCodeConfig({
            name: 'default',
            content: rawContent,
            isDefault: true,
          })
          logger.info('Created database config from workspace file')
        }
        return
      }
    } catch (error) {
      logger.warn('Failed to read workspace config', error)
    }
  }

  const { configSourcePath: importConfigPath } = await getOpenCodeImportStatus()

  if (importConfigPath) {
    logger.info(`Found importable OpenCode config at ${importConfigPath}, importing...`)
    try {
      const result = await syncOpenCodeImport({ db: db!, overwriteState: false })
      if (result.configImported) {
        logger.info(`Imported OpenCode config from ${importConfigPath} to workspace`)
        return
      }
    } catch (error) {
      logger.warn(`Failed to import OpenCode config from ${importConfigPath}`, error)
    }
  }

  const existingDbConfigs = await ss.getOpenCodeConfigs()
  if (existingDbConfigs.configs.length > 0) {
    const defaultConfig = await ss.getDefaultOpenCodeConfig()
    if (defaultConfig) {
      await writeFileContent(workspaceConfigPath, defaultConfig.rawContent)
      logger.info('Wrote existing database config to workspace file')
    }
    return
  }

  logger.info('No existing config found, creating minimal seed config')
  const seedConfig = JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)
  await ss.createOpenCodeConfig({
    name: 'default',
    content: seedConfig,
    isDefault: true,
  })
  await writeFileContent(workspaceConfigPath, seedConfig)
  logger.info('Created minimal seed config')
}

async function backfillOpenCodeModelStateFromFile(): Promise<void> {
  try {
    const modelStatePath = getModelStatePath()
    const fileState = await readJsonSafe<OpenCodeModelStateRecord | null>(modelStatePath, null)

    if (!fileState) {
      return
    }

    const existing = await getOpenCodeModelState(db!, 'default')
    if (existing.recent.length > 0 || existing.favorite.length > 0) {
      return
    }

    const validated = ModelStateSchema.safeParse(fileState)
    if (!validated.success) {
      logger.warn('Model state file has invalid structure, skipping backfill', validated.error)
      return
    }

    for (const model of validated.data.recent) {
      await addRecentOpenCodeModel(db!, model, 'default')
    }
    for (const model of validated.data.favorite) {
      await toggleFavoriteOpenCodeModel(db!, model, 'default')
    }

    logger.info('Backfilled OpenCode model state from model.json to database')
  } catch (error) {
    logger.warn('Failed to backfill OpenCode model state from file:', error)
  }
}

async function ensureHomeStateImported(): Promise<void> {
  try {
    const status = await getOpenCodeImportStatus()
    if (status.workspaceStateExists) {
      return
    }

    if (!status.stateSourcePath) {
      return
    }

    const result = await syncOpenCodeImport({ db: db!, overwriteState: false })
    if (result.stateImported) {
      logger.info(`Imported OpenCode state from ${status.stateSourcePath}`)
    }
  } catch (error) {
    logger.warn('Failed to import OpenCode state, continuing without imported state', error)
  }
}

async function ensureDefaultAgentsMdExists(): Promise<void> {
  const agentsMdPath = getAgentsMdPath()
  const exists = await fileExists(agentsMdPath)
  
  if (!exists) {
    await writeFileContent(agentsMdPath, DEFAULT_AGENTS_MD)
    logger.info(`Created default AGENTS.md at: ${agentsMdPath}`)
  }
}

try {
  await ensureDirectoryExists(getWorkspacePath())
  await ensureDirectoryExists(getConfigPath())
  logger.info('Workspace directories initialized')

  // Initialize database first
  await initializeApp()

  await cleanupExpiredCache()

  await ensureDefaultConfigExists()
  await backfillOpenCodeModelStateFromFile()
  await ensureHomeStateImported()
  await ensureDefaultAgentsMdExists()

  settingsService = new SettingsService(db!)
  await settingsService.initializeLastKnownGoodConfig()

  openCodeSupervisor = new OpenCodeSupervisor(opencodeServerManager, settingsService, {
    userId: 'default'
  })

  await migrateGlobalSkills()

  await installAssistantWorkspace({
    db: db!,
    apiBaseUrl: `http://localhost:${PORT}/api/internal`,
  })
  logger.info('Assistant workspace installed')

  opencodeServerManager.setDatabase(db!)
  const openCodeStatus = await openCodeSupervisor.start()
  if (openCodeStatus.healthy) {
    logger.info(`OpenCode server running on port ${openCodeStatus.port}`)
  } else {
    logger.warn(`OpenCode server unavailable after startup recovery: ${openCodeStatus.lastError ?? openCodeStatus.state}`)
  }

  automationService = new AutomationService(db!, openCodeClient!)
  automationRunnerInstance = new AutomationRunner(automationService)

  notificationService = new NotificationService(db!)

  if (ENV.VAPID.PUBLIC_KEY && ENV.VAPID.PRIVATE_KEY) {
    if (!ENV.VAPID.SUBJECT) {
      logger.warn('VAPID_SUBJECT is not set — push notifications require a mailto: subject (e.g. mailto:you@example.com)')
    } else if (!ENV.VAPID.SUBJECT.startsWith('mailto:')) {
      logger.warn(`VAPID_SUBJECT="${ENV.VAPID.SUBJECT}" does not use mailto: format — iOS/Safari push notifications will fail`)
    }

    notificationService.configureVapid({
      publicKey: ENV.VAPID.PUBLIC_KEY,
      privateKey: ENV.VAPID.PRIVATE_KEY,
      subject: ENV.VAPID.SUBJECT || 'mailto:push@localhost',
    })
    sseAggregator.onEvent((directory, event) => {
      notificationService!.handleSSEEvent(directory, event).catch((err) => {
        logger.error('Push notification dispatch error:', err)
      })
    })
  }

  sseAggregator.setPendingActionsFetcher(openCodeClient!)
  sseAggregator.setPasswordResolver(async () => new SettingsService(db!).getOpenCodeServerPassword())
  sseAggregator.start()

  void automationRunnerInstance.start()

} catch (error) {
  logger.error('Failed to initialize workspace:', error)
}

app.route('/api/auth', createAuthRoutes(db!))
app.route('/api/auth-info', createAuthInfoRoutes(db!))
app.route('/api/health', createHealthRoutes(openCodeSupervisor))

app.route('/api/mcp-oauth-proxy', createMcpOauthProxyRoutes(openCodeClient!, requireAuth!))
app.route('/api/internal', createInternalRoutes(db!, automationService!, notificationService!, settingsService!, openCodeClient!))
app.route('/api/opencode-proxy', createOpenCodeProxyRoutes(db!, settingsService!))
app.route('/api/projects', createProjectRoutes(db!))

const protectedApi = new Hono()
protectedApi.use('/*', requireAuth!)

protectedApi.route('/settings', createSettingsRoutes(db!, openCodeClient!, openCodeSupervisor))
protectedApi.route('/files', createFileRoutes())
protectedApi.route('/providers', createProvidersRoutes(db!, openCodeClient!, openCodeSupervisor))
protectedApi.route('/oauth', createOAuthRoutes(openCodeClient!, openCodeSupervisor))
protectedApi.route('/tts', createTTSRoutes(db!))
protectedApi.route('/stt', createSTTRoutes(db!))
protectedApi.route('/sse', createSSERoutes())
protectedApi.route('/notifications', createNotificationRoutes(notificationService!))
protectedApi.route('/prompt-templates', createPromptTemplateRoutes(db!))
protectedApi.route('/automations', createAutomationRoutes(automationService!))
protectedApi.route('/sessions', createSessionRoutes(db!))

app.route('/api', protectedApi)

app.post('/api/opencode/mcp/:name/auth', requireAuth!, async (c) => {
  const serverName = c.req.param('name')
  const directory = c.req.query('directory')
  return openCodeClient!.startMcpAuth(serverName, directory!)
})

app.post('/api/opencode/mcp/:name/auth/authenticate', requireAuth!, async (c) => {
  const serverName = c.req.param('name')
  const directory = c.req.query('directory')
  return openCodeClient!.authenticateMcp(serverName, directory!)
})

app.all('/api/opencode/*', requireAuth!, async (c) => {
  const request = c.req.raw.clone()
  const response = await openCodeClient!.forwardRaw(c.req.raw)
  await persistOpenCodeSessionRequest(db!, request, response.clone())
  return response
})

async function persistOpenCodeSessionRequest(db: Database, request: Request, response: Response): Promise<void> {
  if (!response.ok) return

  try {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/api\/opencode/, '') || '/'
    const directory = url.searchParams.get('directory')
    const requestBodyText = request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.text()
      : undefined

    if (request.method === 'POST' && path === '/session') {
      const session = await response.json() as { id?: string; title?: string }
      if (!session.id) return
      await upsertSessionRecord(db, {
        sessionId: session.id,
        directory,
        title: session.title ?? getOpenCodeRequestTitle(requestBodyText),
      })
      return
    }

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    const rawSessionId = sessionMatch?.[1]
    if (!rawSessionId) return

    const sessionId = decodeURIComponent(rawSessionId)
    if (request.method === 'PATCH') {
      await upsertSessionRecord(db, {
        sessionId,
        directory,
        title: getOpenCodeRequestTitle(requestBodyText),
      })
      return
    }

    if (request.method === 'DELETE') {
      await deleteSessionRecord(db, sessionId)
    }
  } catch (error) {
    logger.warn('Failed to persist OpenCode session request:', error)
  }
}

function getOpenCodeRequestTitle(requestBodyText: string | undefined): string | null {
  if (!requestBodyText) return null

  try {
    const body = JSON.parse(requestBodyText) as { title?: unknown }
    return typeof body.title === 'string' ? body.title : null
  } catch {
    return null
  }
}

const isProduction = ENV.SERVER.NODE_ENV === 'production'

if (isProduction) {
  app.use('/*', async (c, next) => {
    await next()
    if (c.req.path === '/sw.js') {
      c.res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      c.res.headers.set('Pragma', 'no-cache')
      c.res.headers.set('Expires', '0')
    }
  })

  app.use('/*', serveStatic({ root: './frontend/dist' }))
  
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.notFound()
    }
    const fs = await import('fs/promises')
    const path = await import('path')
    const indexPath = path.join(process.cwd(), 'frontend/dist/index.html')
    const html = await fs.readFile(indexPath, 'utf-8')
    return c.html(html)
  })
} else {
  app.get('/', async (c) => {
    const version = await getAppVersion()
    return c.json({
      name: 'Subpolar',
      version,
      status: 'running',
      endpoints: {
        health: '/api/health',
        projects: '/api/projects',
        settings: '/api/settings',
        sessions: '/api/sessions',
        files: '/api/files',
        providers: '/api/providers',
        opencode_proxy: '/api/opencode/*'
      }
    })
  })

  app.get('/api/network-info', async (c) => {
    const os = await import('os')
    const interfaces = os.networkInterfaces()
    const ips = Object.values(interfaces)
      .flat()
      .filter(info => info && !info.internal && info.family === 'IPv4')
      .map(info => info!.address)
    
    const requestHost = c.req.header('host') || `localhost:${PORT}`
    const protocol = c.req.header('x-forwarded-proto') || 'http'
    
    return c.json({
      host: HOST,
      port: PORT,
      requestHost,
      protocol,
      availableIps: ips,
      apiUrls: [
        `${protocol}://localhost:${PORT}`,
        ...ips.map(ip => `${protocol}://${ip}:${PORT}`)
      ]
    })
  })
}

let isShuttingDown = false

const shutdown = async (signal: string) => {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info(`${signal} received, shutting down gracefully...`)
  try {
    sseAggregator.shutdown()
    logger.info('SSE Aggregator stopped')
    if (openCodeSupervisor) {
      await openCodeSupervisor.stop()
    }
    automationRunnerInstance?.stop()
    logger.info('Automation runner stopped')
    if (!openCodeSupervisor) {
      await opencodeServerManager.stop()
    }
    logger.info('OpenCode server stopped')
  } catch (error) {
    logger.error('Error during shutdown:', error)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
})

logger.info(`🚀 Subpolar API running on http://${HOST}:${PORT}`)
