import { Hono } from 'hono'
import { getPiProviders } from '../runtime/pi/models'

export function createRuntimeRoutes() {
  const app = new Hono()

  app.get('/config', async (c) => c.json({
    runtime: 'pi',
    model: null,
    small_model: null,
    provider: {},
  }))

  app.patch('/config', async (c) => c.json(await c.req.json().catch(() => ({}))))

  app.get('/provider', async (c) => c.json(await getPiProviders()))
  app.get('/config/providers', async (c) => c.json({}))
  app.get('/command', async (c) => c.json([]))
  app.get('/permission', async (c) => c.json([]))
  app.get('/question', async (c) => c.json([]))
  app.get('/lsp', async (c) => c.json([]))

  return app
}
