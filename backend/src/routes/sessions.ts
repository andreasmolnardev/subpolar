import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { listSessionRecords } from '../db/sessions'

export function createSessionRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    const sessions = await listSessionRecords(db)
    return c.json({ sessions })
  })

  return app
}
