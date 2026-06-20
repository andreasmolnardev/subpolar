import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { listSessionRecords, upsertSessionRecord } from '../db/sessions'

export function createSessionRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    const sessions = await listSessionRecords(db)
    return c.json({ sessions })
  })

  app.patch('/:id', async (c) => {
    const sessionId = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as {
      directory?: unknown
      title?: unknown
      projectId?: unknown
    }

    await upsertSessionRecord(db, {
      sessionId,
      directory: typeof body.directory === 'string' ? body.directory : null,
      title: typeof body.title === 'string' ? body.title : null,
      projectId: typeof body.projectId === 'number' || typeof body.projectId === 'string' ? String(body.projectId) : undefined,
    })

    return c.json({ success: true })
  })

  return app
}
