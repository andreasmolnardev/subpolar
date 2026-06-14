import { Hono } from 'hono'
import type { Database } from '../../db/schema'
import { listRepos } from '../../db/queries'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import path from 'path'

export function createInternalOpenCodeWorkspacesRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const repos = await listRepos(db)
      const workspaces = repos
        .filter((repo) => repo.cloneStatus === 'ready')
        .map((repo) => ({
          repoId: repo.id,
          name: repo.repoUrl
            ? repo.repoUrl.split('/').slice(-1)[0]?.replace('.git', '') || repo.localPath
            : repo.sourcePath
              ? path.basename(repo.sourcePath)
              : repo.localPath,
          branch: repo.branch ?? null,
          cloneStatus: repo.cloneStatus,
          directory: repo.fullPath,
          originUrl: repo.repoUrl ?? null,
          extra: {
            repoId: repo.id,
            localPath: repo.localPath,
            fullPath: repo.fullPath,
          },
        }))
      return c.json({ workspaces })
    } catch (error) {
      logger.error('Failed to list opencode workspaces:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
