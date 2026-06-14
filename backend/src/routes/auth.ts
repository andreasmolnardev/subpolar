import { Hono } from 'hono'
import type { AuthInstance } from '../auth'
import { ENV } from '@subpolar/shared/config/env'
import { logger } from '../utils/logger'

export function createAuthRoutes(auth: AuthInstance): Hono {
  const app = new Hono()

  app.all('/*', async (c) => {
    const response = await auth.handler(c.req.raw)

    const setCookie = response.headers.get('set-cookie')
    if (c.req.path.includes('sign-in')) {
      logger.info(`Sign-in response - Status: ${response.status}, Set-Cookie: ${setCookie ? 'present' : 'missing'}`)
      if (setCookie) {
        logger.debug(`Set-Cookie header: ${setCookie.substring(0, 100)}...`)
      }
    }

    return response
  })

  return app
}

const isAdminConfigured = (): boolean => {
  return !!(ENV.AUTH.ADMIN_EMAIL && ENV.AUTH.ADMIN_PASSWORD)
}

export async function syncAdminFromEnv(auth: AuthInstance): Promise<void> {
  if (!isAdminConfigured()) return

  const adminEmail = ENV.AUTH.ADMIN_EMAIL!
  const adminPassword = ENV.AUTH.ADMIN_PASSWORD!

  try {
    const existingUser = await auth.api.listUsers({
      query: {
        filter: `email = "${adminEmail}"`,
      },
    })

    if (existingUser && existingUser.total > 0) {
      if (ENV.AUTH.ADMIN_PASSWORD_RESET) {
        logger.info(`Admin password reset from environment for ${adminEmail}`)
        logger.warn('Remove ADMIN_PASSWORD_RESET=true from environment after password reset')
      }
      return
    }

    await auth.api.signUpEmail({
      body: {
        email: adminEmail,
        password: adminPassword,
        name: 'Admin',
      },
    })
    logger.info(`Admin user created from environment: ${adminEmail}`)
  } catch (error) {
    logger.error('Failed to create admin user from environment:', error)
  }
}

export function createAuthInfoRoutes(auth: AuthInstance) {
  const app = new Hono()

  app.get('/config', async (c) => {
    const enabledProviders: string[] = ['credentials']

    if (ENV.AUTH.GITHUB_CLIENT_ID && ENV.AUTH.GITHUB_CLIENT_SECRET) {
      enabledProviders.push('github')
    }
    if (ENV.AUTH.GOOGLE_CLIENT_ID && ENV.AUTH.GOOGLE_CLIENT_SECRET) {
      enabledProviders.push('google')
    }
    if (ENV.AUTH.DISCORD_CLIENT_ID && ENV.AUTH.DISCORD_CLIENT_SECRET) {
      enabledProviders.push('discord')
    }

    enabledProviders.push('passkey')

    let isFirstUser = true
    try {
      const users = await auth.api.listUsers({ query: { limit: 1 } })
      isFirstUser = users.total === 0
    } catch {
      // if API fails, assume first user
    }

    const adminConfigured = isAdminConfigured()

    return c.json({
      enabledProviders,
      registrationEnabled: !adminConfigured,
      isFirstUser,
      adminConfigured,
    })
  })

  app.get('/me', async (c) => {
    try {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      })

      if (!session) {
        return c.json({ user: null, session: null })
      }

      return c.json({
        user: session.user,
        session: {
          id: session.session.id,
          expiresAt: session.session.expiresAt,
        },
      })
    } catch {
      return c.json({ user: null, session: null })
    }
  })

  return app
}
