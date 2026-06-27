import { Hono } from 'hono'

export function createInternalPiWorkspacesRoutes() {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      return c.json({ workspaces: [] })
    } catch (error) {
      logger.error('Failed to list PiInternal workspaces:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
