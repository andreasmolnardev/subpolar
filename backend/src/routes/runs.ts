import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { streamSSE } from 'hono/streaming'
import { getActiveRunForSession, getRun, listRuntimeEvents, updateRunStatus } from '../db/runs'
import type { RuntimeRegistry } from '../runtime/registry'

const EVENT_POLL_INTERVAL_MS = 100

export function createRunRoutes(db: Database, runtimeRegistry?: RuntimeRegistry) {
  const app = new Hono()

  app.post('/:runId/cancel', async (c) => {
    const run = await getRun(db, c.req.param('runId')) ?? await getActiveRunForSession(db, c.req.param('runId'))
    if (!run) return c.json({ error: 'Run not found' }, 404)
    if (!runtimeRegistry) return c.json({ error: 'Runtime registry is unavailable' }, 503)

    await runtimeRegistry.get(run.runtime).cancel(run.runId)
    await updateRunStatus(db, run.runId, 'cancelled')
    return c.json({ success: true })
  })

  app.get('/:runId/events', async (c) => {
    return c.json({ events: await listRuntimeEvents(db, c.req.param('runId')) })
  })

  app.get('/:runId/events/stream', async (c) => {
    const runId = c.req.param('runId')
    const run = await getRun(db, runId)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    c.header('Cache-Control', 'no-cache, no-store, no-transform')
    c.header('X-Accel-Buffering', 'no')

    return streamSSE(c, async (stream) => {
      let sent = 0
      let heartbeatAt = Date.now()

      while (!stream.aborted) {
        const events = await listRuntimeEvents(db, runId)
        for (const event of events.slice(sent)) {
          await stream.writeSSE({
            event: 'runtime',
            id: event.id,
            data: JSON.stringify(event),
          })
          sent += 1
        }

        const latestRun = await getRun(db, runId)
        if (!latestRun || latestRun.status === 'completed' || latestRun.status === 'failed' || latestRun.status === 'cancelled') {
          await stream.writeSSE({
            event: 'runtime.end',
            data: JSON.stringify({ status: latestRun?.status ?? 'failed' }),
          })
          return
        }

        if (Date.now() - heartbeatAt >= 15000) {
          await stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ timestamp: Date.now() }) })
          heartbeatAt = Date.now()
        }

        await new Promise(resolve => setTimeout(resolve, EVENT_POLL_INTERVAL_MS))
      }
    })
  })

  return app
}
