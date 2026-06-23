import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { deleteSessionRecord, getSessionRecord, listSessionRecords, upsertSessionRecord } from '../db/sessions'
import { createMessage, createRun, getRun, getSessionStatuses, listMessages, updateRunStatus, writeRuntimeEvent } from '../db/runs'
import type { RuntimeId } from '../runtime/types'
import type { RuntimeRegistry } from '../runtime/registry'

export function createSessionRoutes(db: Database, runtimeRegistry?: RuntimeRegistry) {
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

  app.get('/status', async (c) => {
    return c.json(await getSessionStatuses(db))
  })

  app.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { directory?: unknown; title?: unknown; projectId?: unknown; runtime?: unknown; runtimeSessionId?: unknown }
    const sessionId = crypto.randomUUID()
    await upsertSessionRecord(db, {
      sessionId,
      directory: typeof body.directory === 'string' ? body.directory : null,
      title: typeof body.title === 'string' ? body.title : null,
      projectId: typeof body.projectId === 'number' || typeof body.projectId === 'string' ? String(body.projectId) : undefined,
    })
    return c.json({ session: { id: sessionId, runtime: 'pi', runtimeSessionId: null } }, 201)
  })

  app.get('/:id', async (c) => {
    const session = await getSessionRecord(db, c.req.param('id'))
    if (!session) return c.json({ error: 'Session not found' }, 404)
    return c.json(session)
  })

  app.delete('/:id', async (c) => {
    await deleteSessionRecord(db, c.req.param('id'))
    return c.body(null, 204)
  })

  app.get('/:id/messages', async (c) => {
    return c.json({ messages: await listMessages(db, c.req.param('id')) })
  })

  app.post('/:id/messages', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { role?: unknown; content?: unknown; metadata?: unknown }
    const role = body.role === 'assistant' || body.role === 'system' || body.role === 'tool' ? body.role : 'user'
    const content = typeof body.content === 'string' ? body.content : ''
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : {}
    const message = await createMessage(db, { sessionId: c.req.param('id'), role, content, metadata })
    return c.json({ message }, 201)
  })

  app.post('/:id/runs', async (c) => {
    if (!runtimeRegistry) return c.json({ error: 'Runtime registry is unavailable' }, 503)

    const body = await c.req.json().catch(() => ({})) as { agentId?: unknown; runtime?: unknown; projectId?: unknown }
    const agentId = typeof body.agentId === 'string' ? body.agentId : 'default'
    const runtime: RuntimeId = 'pi'
    const run = await createRun(db, { sessionId: c.req.param('id'), agentId, runtime })

    void executeRun(db, runtimeRegistry, run.runId, typeof body.projectId === 'string' ? body.projectId : null)
    return c.json({ run }, 201)
  })

  return app
}

async function executeRun(db: Database, runtimeRegistry: RuntimeRegistry, runId: string, projectId: string | null): Promise<void> {
  const run = await getRun(db, runId)
  if (!run) return

  await updateRunStatus(db, runId, 'running')
  const messages = await listMessages(db, run.sessionId)

  try {
    for await (const event of runtimeRegistry.get(run.runtime).run({
      runId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      projectId,
      messages,
    })) {
      await writeRuntimeEvent(db, { runId, sessionId: run.sessionId, event })
      if (event.type === 'run.failed') {
        await updateRunStatus(db, runId, 'failed', event.error)
        return
      }
      if (event.type === 'run.completed') {
        await updateRunStatus(db, runId, 'completed')
        return
      }
    }
    await updateRunStatus(db, runId, 'completed')
  } catch (error) {
    await updateRunStatus(db, runId, 'failed', error instanceof Error ? error.message : 'Runtime execution failed')
  }
}
