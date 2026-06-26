import { Hono } from 'hono'
import { z } from 'zod'
import { getPiProviders } from '../runtime/pi/models'
import {
  OAuthAuthorizeRequestSchema,
  OAuthCallbackRequestSchema,
} from '../../../shared/src/schemas/auth'

export function createOAuthRoutes() {
  const app = new Hono()

  app.post('/:id/oauth/authorize', async (c) => {
    try {
      await OAuthAuthorizeRequestSchema.parseAsync(await c.req.json())
      return c.json({ error: `Pi OAuth is not implemented for ${c.req.param('id')}` }, 501)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'OAuth authorization is not implemented' }, 501)
    }
  })

  app.post('/:id/oauth/callback', async (c) => {
    try {
      await OAuthCallbackRequestSchema.parseAsync(await c.req.json())
      return c.json({ error: `Pi OAuth is not implemented for ${c.req.param('id')}` }, 501)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'OAuth callback is not implemented' }, 501)
    }
  })

  app.get('/auth-methods', async (c) => {
    const providers = await getPiProviders()
    return c.json({
      providers: Object.fromEntries(
        providers.all.map((provider) => [provider.id, [{ type: 'api', label: 'API Key' }]]),
      ),
    })
  })

  return app
}
