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
import { createProductivityRoutes } from './routes/productivity'

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
import { createAuthRoutes, createAuthInfoRoutes } from './routes/auth'
import { createAuthMiddleware } from './auth/middleware'
import { createPromptTemplateRoutes } from './routes/prompt-templates'
import { createProjectRoutes } from './routes/projects'
import { createSessionRoutes } from './routes/sessions'
import { createRunRoutes } from './routes/runs'
import { createAgentRoutes } from './routes/agents'
import { createRuntimeRoutes } from './routes/runtime'
import { createPiRoutes } from './pi/routes'
import { createInternalRoutes } from './routes/internal'
import { createSubpolarCliRoutes } from './routes/subpolar-cli'
import { sseAggregator } from './services/sse-aggregator'
import { ensureDirectoryExists, writeFileContent, fileExists } from './services/file-operations'
import { SettingsService } from './services/settings'
import { NotificationService } from './services/notification'
import { AutomationRunner, AutomationService } from './services/automations'
import { migrateGlobalSkills } from './services/skills'
import { ensureGeneralChatProject } from './db/projects'
import { installAssistantWorkspace } from './services/general-chat'

import { logger } from './utils/logger'
import { seedTools } from './db/subpolar-tools'
import { SUBPOLAR_POLICY_SEEDS, SUBPOLAR_TOOL_SEEDS } from './services/subpolar-tool-seeds'
import { discoverConfiguredMcpTools } from './services/mcp'
import { discoverConfiguredOpenApiTools } from './services/openapi'
import { createRuntimeRegistry, type RuntimeRegistry } from './runtime/registry'
import { PiNativeClient } from './runtime/pi/client'
import { 
  getWorkspacePath, 
  getConfigPath,
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

  c.header('x-request-id', requestId)
  logger.info(`${c.req.method} ${target} origin=${origin}"`)

  try {
    await next()
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt)
    logger.error(`Request ${requestId} !! ${c.req.method} ${target} failed after ${durationMs}ms`, error)
    throw error
  }

  const durationMs = Math.round(performance.now() - startedAt)
  const level = c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info'
  logger[level](`${c.req.method} ${target} ${c.res.status} ${durationMs}ms`)
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
let piInternalClient: PiNativeClient | undefined
let automationService: AutomationService | undefined
let automationRunnerInstance: AutomationRunner | undefined
let notificationService: NotificationService | undefined
let settingsService: SettingsService | undefined
let runtimeRegistry: RuntimeRegistry | undefined

async function initializeApp() {
  db = await initializeDatabase()
  await ensureGeneralChatProject(db!).catch((err) => logger.warn('Failed to ensure general chat project:', err))
  await seedTools(db!, SUBPOLAR_TOOL_SEEDS, SUBPOLAR_POLICY_SEEDS).catch((err) => logger.warn('Failed to seed Subpolar tools:', err))
  await discoverConfiguredMcpTools(db!, true)
  await discoverConfiguredOpenApiTools(db!, true)
  requireAuth = createAuthMiddleware()
}

import { DEFAULT_AGENTS_MD } from './constants'

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

  await ensureDefaultAgentsMdExists()

  settingsService = new SettingsService(db!)
  runtimeRegistry = await createRuntimeRegistry({ db: db!, settingsService })
  piInternalClient = new PiNativeClient()

  await migrateGlobalSkills()

  await installAssistantWorkspace({
    db: db!,
    apiBaseUrl: `http://localhost:${PORT}/api/internal`,
  })
  logger.info('General Chat workspace installed')

  automationService = new AutomationService(db!, piInternalClient!)
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

  sseAggregator.start()

  void automationRunnerInstance.start()

} catch (error) {
  logger.error('Failed to initialize workspace:', error)
  throw error
}

app.route('/api/auth', createAuthRoutes(db!))
app.route('/api/auth-info', createAuthInfoRoutes(db!))
app.route('/api/health', createHealthRoutes())

app.route('/api/internal', createInternalRoutes(db!, automationService!, notificationService!, settingsService!, piInternalClient!))
app.route('/api/pi', createPiRoutes(db!))
app.route('/api/projects', createProjectRoutes(db!))
app.route('/api/subpolar-cli', createSubpolarCliRoutes(db!))

const protectedApi = new Hono()
protectedApi.use('/*', requireAuth!)

protectedApi.route('/settings', createSettingsRoutes(db!))
protectedApi.route('/files', createFileRoutes())
protectedApi.route('/providers', createProvidersRoutes(db!))
protectedApi.route('/oauth', createOAuthRoutes())
protectedApi.route('/tts', createTTSRoutes(db!))
protectedApi.route('/stt', createSTTRoutes(db!))
protectedApi.route('/sse', createSSERoutes())
protectedApi.route('/notifications', createNotificationRoutes(notificationService!))
protectedApi.route('/prompt-templates', createPromptTemplateRoutes(db!))
protectedApi.route('/automations', createAutomationRoutes(automationService!))
protectedApi.route('/productivity', createProductivityRoutes(db!))
protectedApi.route('/sessions', createSessionRoutes(db!, runtimeRegistry))
protectedApi.route('/runs', createRunRoutes(db!, runtimeRegistry))
protectedApi.route('/agent', createAgentRoutes(db!))
protectedApi.route('/', createRuntimeRoutes(db!))

app.route('/api', protectedApi)

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
        runtime: '/api/runs'
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
    automationRunnerInstance?.stop()
    logger.info('Automation runner stopped')
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
