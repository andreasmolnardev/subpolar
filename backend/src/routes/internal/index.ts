import { Hono } from 'hono'
import type { Database } from '../../db/schema'
import type { AutomationService } from '../../services/automations'
import type { NotificationService } from '../../services/notification'
import type { SettingsService } from '../../services/settings'
import type { PiInternalClient as OpenCodeClient } from '../../runtime/pi/internal-client-types'
import { createAutomationRoutes } from '../automations'
import { createInternalTokenMiddleware } from '../../auth/internal-token-middleware'
import { createInternalNotificationRoutes } from './notifications'
import { createInternalSettingsRoutes } from './settings'
import { createInternalRepoRoutes } from './repos'
import { createInternalRepoSyncRoutes } from './repo-sync'
import { createInternalOpenCodeWorkspacesRoutes } from './opencode-workspaces'
import { createInternalAssistantRoutes } from './assistant'

export function createInternalRoutes(
  db: Database,
  automationService: AutomationService,
  notificationService: NotificationService,
  settingsService: SettingsService,
  openCodeClient: OpenCodeClient,
) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))
  app.route('/automations', createAutomationRoutes(automationService))
  app.route('/notifications', createInternalNotificationRoutes(notificationService))
  app.route('/settings', createInternalSettingsRoutes(settingsService))
  const repos = new Hono()
  repos.route('/', createInternalRepoRoutes())
  repos.route('/:id/automations', createAutomationRoutes(automationService))
  repos.route('/', createInternalRepoSyncRoutes())
  app.route('/repos', repos)
  app.route('/opencode-workspaces', createInternalOpenCodeWorkspacesRoutes())
  app.route('/assistant', createInternalAssistantRoutes(openCodeClient))
  return app
}
