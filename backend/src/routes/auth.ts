import { Hono } from 'hono'
import PocketBase from 'pocketbase'
import { syncAdminFromEnv, signInUser, signUpUser, signOutUser, getUserCount, updateUserPassword } from '../auth'
import { POCKETBASE_URL } from '../db/pocketbase-client'
import { ENV } from '@subpolar/shared/config/env'

export function createAuthRoutes(pb: PocketBase) {
  const app = new Hono()

  syncAdminFromEnv(pb)

  app.post('/sign-in/email', async (c) => {
    const { email, password } = await c.req.json()
    const userPb = new PocketBase(POCKETBASE_URL)
    try {
      const result = await signInUser(userPb, email, password)
      const cookie = userPb.authStore.exportToCookie({ httpOnly: false })
      c.header('set-cookie', cookie)
      return c.json({ token: result.token, user: result.record })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid credentials'
      return c.json({ message }, 401)
    }
  })

  app.post('/sign-up/email', async (c) => {
    const { email, password, name } = await c.req.json()
    try {
      await signUpUser(pb, email, password, name)
      const userPb = new PocketBase(POCKETBASE_URL)
      const result = await signInUser(userPb, email, password)
      const cookie = userPb.authStore.exportToCookie({ httpOnly: false })
      c.header('set-cookie', cookie)
      return c.json({ token: result.token, user: result.record }, 201)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      return c.json({ message }, 400)
    }
  })

  app.post('/sign-out', async (c) => {
    signOutUser(pb)
    c.header('set-cookie', 'pb_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    return c.json({ success: true })
  })

  app.put('/change-password', async (c) => {
    const { currentPassword, newPassword } = await c.req.json()
    const cookie = c.req.header('cookie') || ''
    if (!cookie) return c.json({ message: 'Not authenticated' }, 401)

    const userPb = new PocketBase(POCKETBASE_URL)
    userPb.authStore.loadFromCookie(cookie)

    if (!userPb.authStore.isValid) {
      return c.json({ message: 'Not authenticated' }, 401)
    }

    try {
      await updateUserPassword(pb, userPb.authStore.model?.id as string, currentPassword, newPassword)
      return c.json({ success: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to change password'
      return c.json({ message }, 400)
    }
  })

  app.get('/session', async (c) => {
    const cookie = c.req.header('cookie') || ''
    const tempPb = new PocketBase(POCKETBASE_URL)
    if (cookie) tempPb.authStore.loadFromCookie(cookie)

    if (tempPb.authStore.isValid) {
      try {
        await tempPb.collection('users').authRefresh()
        return c.json({ user: tempPb.authStore.model, token: tempPb.authStore.token })
      } catch {
        return c.json({ user: null, token: null })
      }
    }
    return c.json({ user: null, token: null })
  })

  app.get('/config', async (c) => {
    const userCount = await getUserCount(pb)
    return c.json({
      enabledProviders: ['email'],
      registrationEnabled: true,
      isFirstUser: userCount === 0,
    })
  })

  return app
}

export function createAuthInfoRoutes(pb: PocketBase) {
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

    const userCount = await getUserCount(pb)

    return c.json({
      enabledProviders,
      isFirstUser: userCount === 0,
      adminConfigured: !!(ENV.AUTH.ADMIN_EMAIL && ENV.AUTH.ADMIN_PASSWORD),
    })
  })

  app.get('/me', async (c) => {
    const cookie = c.req.header('cookie') || ''
    const tempPb = new PocketBase(POCKETBASE_URL)
    if (cookie) tempPb.authStore.loadFromCookie(cookie)

    if (tempPb.authStore.isValid) {
      try {
        await tempPb.collection('users').authRefresh()
        return c.json({ user: tempPb.authStore.model })
      } catch {
        return c.json({ user: null })
      }
    }
    return c.json({ user: null })
  })

  return app
}
