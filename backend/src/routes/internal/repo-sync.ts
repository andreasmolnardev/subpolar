import { Hono } from 'hono'

export function createInternalRepoSyncRoutes() {
  const app = new Hono()

  app.get('/:repoId/git-info', async (c) => {
    return c.json({ error: 'git-info is not available' }, 404)
  })

  return app
}
