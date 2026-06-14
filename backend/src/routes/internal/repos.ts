import { Hono } from 'hono'
import type { Database } from '../../db/schema'
import type { SettingsService } from '../../services/settings'
import { listRepos } from '../../db/queries'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'

export function createInternalRepoRoutes(db: Database, settingsService: SettingsService) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const settings = await settingsService.getSettings()
      const repos = await listRepos(db, settings.preferences.repoOrder)
      return c.json({ repos })
    } catch (error) {
      logger.error('Failed to list internal repos:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}