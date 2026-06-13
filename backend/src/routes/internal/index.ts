import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { AutomationService } from '../../services/automations'
import type { NotificationService } from '../../services/notification'
import type { SettingsService } from '../../services/settings'
import type { OpenCodeClient } from '../../services/opencode/client'
import { createAutomationRoutes } from '../automations'
import { createInternalTokenMiddleware } from '../../auth/internal-token-middleware'
import { createInternalNotificationRoutes } from './notifications'
import { createInternalSettingsRoutes } from './settings'
import { createInternalRepoRoutes } from './repos'
import { createInternalRepoSyncRoutes } from './repo-sync'
import { createInternalRepoMirrorRoutes as mirrorRoutes } from './repo-mirror'
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
  repos.route('/', createInternalRepoRoutes(db, settingsService))
  repos.route('/:id/automations', createAutomationRoutes(automationService))
  repos.route('/', createInternalRepoSyncRoutes(db))
  repos.route('/', mirrorRoutes(db))
  app.route('/repos', repos)
  app.route('/opencode-workspaces', createInternalOpenCodeWorkspacesRoutes(db))
  app.route('/assistant', createInternalAssistantRoutes(openCodeClient))
  return app
}
