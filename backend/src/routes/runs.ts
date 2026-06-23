import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { getRun, listRuntimeEvents, updateRunStatus } from '../db/runs'
import type { RuntimeRegistry } from '../runtime/registry'

export function createRunRoutes(db: Database, runtimeRegistry?: RuntimeRegistry) {
  const app = new Hono()

  app.post('/:runId/cancel', async (c) => {
    const run = await getRun(db, c.req.param('runId'))
    if (!run) return c.json({ error: 'Run not found' }, 404)
    if (!runtimeRegistry) return c.json({ error: 'Runtime registry is unavailable' }, 503)

    await runtimeRegistry.get(run.runtime).cancel(run.runId)
    await updateRunStatus(db, run.runId, 'cancelled')
    return c.json({ success: true })
  })

  app.get('/:runId/events', async (c) => {
    return c.json({ events: await listRuntimeEvents(db, c.req.param('runId')) })
  })

  return app
}
