import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { deleteSessionRecord, getSessionRecord, listSessionRecords, upsertSessionRecord } from '../db/sessions'
import { createMessage, createRun, getRun, getSessionStatuses, listMessages, updateRunStatus, writeRuntimeEvent } from '../db/runs'
import type { RuntimeId, RuntimeUsage } from '../runtime/types'
import type { RuntimeRegistry } from '../runtime/registry'
import { sseAggregator } from '../services/sse-aggregator'

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
    const directory = c.req.query('directory')
    if (directory) {
      sseAggregator.publish(directory, {
        type: 'message.updated',
        properties: {
          info: {
            id: message.id,
            sessionID: c.req.param('id'),
            role,
            time: { created: message.createdAt },
          },
        },
      })
      if (content) {
        sseAggregator.publish(directory, {
          type: 'message.part.updated',
          properties: {
            part: {
              id: `${message.id}-text`,
              sessionID: c.req.param('id'),
              messageID: message.id,
              type: 'text',
              text: content,
            },
          },
        })
      }
    }
    return c.json({ message }, 201)
  })

  app.post('/:id/runs', async (c) => {
    if (!runtimeRegistry) return c.json({ error: 'Runtime registry is unavailable' }, 503)

    const body = await c.req.json().catch(() => ({})) as { agentId?: unknown; runtime?: unknown; projectId?: unknown; model?: unknown }
    const agentId = typeof body.agentId === 'string' ? body.agentId : 'default'
    const model = body.model && typeof body.model === 'object' ? body.model as Record<string, unknown> : undefined
    const runtime: RuntimeId = 'pi'
    const run = await createRun(db, { sessionId: c.req.param('id'), agentId, runtime })
    const directory = c.req.query('directory')

    void executeRun(db, runtimeRegistry, run.runId, typeof body.projectId === 'string' ? body.projectId : null, model, directory)
    return c.json({ run }, 201)
  })

  return app
}

function createEmptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: { total: 0 },
  }
}

function getModelId(model?: Record<string, unknown>): string | undefined {
  const providerID = typeof model?.providerID === 'string' ? model.providerID : undefined
  const modelID = typeof model?.modelID === 'string' ? model.modelID : undefined
  if (!providerID || !modelID) return undefined
  return `${providerID}/${modelID}`
}

function normalizeUsage(usage: RuntimeUsage) {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    reasoning: usage.reasoning ?? 0,
    cost: { total: usage.cost?.total ?? 0 },
  }
}

async function executeRun(db: Database, runtimeRegistry: RuntimeRegistry, runId: string, projectId: string | null, model?: Record<string, unknown>, directory?: string): Promise<void> {
  const run = await getRun(db, runId)
  if (!run) return

  await updateRunStatus(db, runId, 'running')
  const messages = await listMessages(db, run.sessionId)
  const assistantMessageId = crypto.randomUUID()
  const assistantPartId = `${assistantMessageId}-text`
  const reasoningPartId = `${assistantMessageId}-reasoning`
  const assistantCreatedAt = Date.now()
  let assistantCompletedAt: number | null = null
  let assistantModelId = getModelId(model)
  let assistantFinishReason = 'stop'
  let assistantUsage = createEmptyUsage()
  let assistantContent = ''
  let reasoningContent = ''
  let assistantMessageStarted = false
  let assistantTextPartStarted = false
  let reasoningPartStarted = false

  const publish = (event: Parameters<typeof sseAggregator.publish>[1]) => {
    if (directory) sseAggregator.publish(directory, event)
  }

  const publishAssistantMessageStarted = () => {
    if (assistantMessageStarted) return
    assistantMessageStarted = true
    publish({
      type: 'message.updated',
      properties: {
        info: {
          id: assistantMessageId,
          sessionID: run.sessionId,
          role: 'assistant',
          time: { created: assistantCreatedAt },
        },
      },
    })
  }

  const finishAssistantMessage = async () => {
    if (!assistantContent && !reasoningContent) return
    await createMessage(db, {
      sessionId: run.sessionId,
      role: 'assistant',
      content: assistantContent,
      metadata: {
        runId,
        reasoning: reasoningContent,
        completedAt: assistantCompletedAt ?? Date.now(),
        modelID: assistantModelId,
        finishReason: assistantFinishReason,
        usage: assistantUsage,
      },
    })
    if (!assistantMessageStarted) return
    publish({
      type: 'message.updated',
      properties: {
        info: {
          id: assistantMessageId,
          sessionID: run.sessionId,
          role: 'assistant',
          time: { created: assistantCreatedAt, completed: assistantCompletedAt ?? Date.now() },
          modelID: assistantModelId,
        },
      },
    })
    publishStepFinishPart()
  }

  const publishReasoningPartStarted = () => {
    if (reasoningPartStarted) return
    reasoningPartStarted = true
    publish({
      type: 'message.part.updated',
      properties: {
        part: {
          id: reasoningPartId,
          sessionID: run.sessionId,
          messageID: assistantMessageId,
          type: 'reasoning',
          text: '',
          time: { start: assistantCreatedAt },
        },
      },
    })
  }

  const publishAssistantTextPartStarted = () => {
    if (assistantTextPartStarted) return
    assistantTextPartStarted = true
    publish({
      type: 'message.part.updated',
      properties: {
        part: {
          id: assistantPartId,
          sessionID: run.sessionId,
          messageID: assistantMessageId,
          type: 'text',
          text: '',
        },
      },
    })
  }

  const publishStepFinishPart = () => {
    publish({
      type: 'message.part.updated',
      properties: {
        part: {
          id: `${assistantMessageId}-step-finish`,
          sessionID: run.sessionId,
          messageID: assistantMessageId,
          type: 'step-finish',
          reason: assistantFinishReason,
          cost: assistantUsage.cost.total ?? 0,
          tokens: {
            input: assistantUsage.input,
            output: assistantUsage.output,
            reasoning: assistantUsage.reasoning ?? 0,
            cache: {
              read: assistantUsage.cacheRead,
              write: assistantUsage.cacheWrite,
            },
          },
        },
      },
    })
  }

  publish({ type: 'session.status', properties: { sessionID: run.sessionId, status: { type: 'busy' } } })

  try {
    for await (const event of runtimeRegistry.get(run.runtime).run({
      runId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      projectId,
      messages,
      model,
    })) {
      await writeRuntimeEvent(db, { runId, sessionId: run.sessionId, event })
      if (event.type === 'message.delta') {
        assistantContent += event.content
        publishAssistantMessageStarted()
        publishAssistantTextPartStarted()
        publish({
          type: 'message.part.delta',
          properties: {
            sessionID: run.sessionId,
            messageID: assistantMessageId,
            partID: assistantPartId,
            field: 'text',
            delta: event.content,
          },
        })
      }
      if (event.type === 'message.reasoning.delta') {
        reasoningContent += event.content
        publishAssistantMessageStarted()
        publishReasoningPartStarted()
        publish({
          type: 'message.part.delta',
          properties: {
            sessionID: run.sessionId,
            messageID: assistantMessageId,
            partID: reasoningPartId,
            field: 'text',
            delta: event.content,
          },
        })
      }
      if (event.type === 'message.completed') {
        assistantCompletedAt = Date.now()
        assistantModelId = event.model ?? assistantModelId
        assistantFinishReason = event.reason ?? assistantFinishReason
        assistantUsage = event.usage ? normalizeUsage(event.usage) : assistantUsage
      }
      if (event.type === 'run.failed') {
        await finishAssistantMessage()
        await updateRunStatus(db, runId, 'failed', event.error)
        publish({ type: 'session.error', properties: { sessionID: run.sessionId, error: { name: 'UnknownError', message: event.error } } })
        publish({ type: 'session.status', properties: { sessionID: run.sessionId, status: { type: 'idle' } } })
        publish({ type: 'session.idle', properties: { sessionID: run.sessionId } })
        return
      }
      if (event.type === 'run.completed') {
        await finishAssistantMessage()
        await updateRunStatus(db, runId, 'completed')
        publish({ type: 'session.status', properties: { sessionID: run.sessionId, status: { type: 'idle' } } })
        publish({ type: 'session.idle', properties: { sessionID: run.sessionId } })
        return
      }
    }
    await finishAssistantMessage()
    await updateRunStatus(db, runId, 'completed')
    publish({ type: 'session.status', properties: { sessionID: run.sessionId, status: { type: 'idle' } } })
    publish({ type: 'session.idle', properties: { sessionID: run.sessionId } })
  } catch (error) {
    await updateRunStatus(db, runId, 'failed', error instanceof Error ? error.message : 'Runtime execution failed')
    publish({ type: 'session.error', properties: { sessionID: run.sessionId, error: { name: 'UnknownError', message: error instanceof Error ? error.message : 'Runtime execution failed' } } })
    publish({ type: 'session.status', properties: { sessionID: run.sessionId, status: { type: 'idle' } } })
    publish({ type: 'session.idle', properties: { sessionID: run.sessionId } })
  }
}
