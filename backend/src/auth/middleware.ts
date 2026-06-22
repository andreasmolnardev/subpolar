import type { Context, Next } from 'hono'
import PocketBase from 'pocketbase'
import { POCKETBASE_URL } from '../db/pocketbase-client'

export function createAuthMiddleware(pbClient?: PocketBase) {
  return async (c: Context, next: Next) => {
    const pb = pbClient ? new PocketBase(pbClient.baseUrl) : new PocketBase(POCKETBASE_URL)
    pb.autoCancellation(false)

    const cookie = c.req.header('cookie') || ''
    const authHeader = c.req.header('authorization') || ''

    if (authHeader.startsWith('Bearer ')) {
      pb.authStore.save(authHeader.slice(7), null)
    } else if (cookie) {
      pb.authStore.loadFromCookie(cookie)
    }

    if (pb.authStore.isValid) {
      try {
        await pb.collection('users').authRefresh()
        c.set('user', pb.authStore.model)
        c.set('session', {
          token: pb.authStore.token,
          userId: pb.authStore.model?.id,
        })
      } catch {
        pb.authStore.clear()
        c.set('user', null)
        c.set('session', null)
        return c.json({ message: 'Unauthorized' }, 401)
      }
    } else {
      c.set('user', null)
      c.set('session', null)
      return c.json({ message: 'Unauthorized' }, 401)
    }

    await next()
  }
}
