import { Hono } from 'hono'

export function createInternalRepoRoutes() {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      return c.json({ repos: [] })
    } catch (error) {
      logger.error('Failed to list internal repos:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
