import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { deleteSessionRecord, getSessionRecord, listSessionRecords, listSessionRecordsByDirectory, upsertSessionRecord } from '../db/sessions'
import { createMessage, createRun, getRun, getSessionStatuses, listMessages, updateRunStatus, writeRuntimeEvent } from '../db/runs'
import type { RuntimeId, RuntimeUsage } from '../runtime/types'
import type { RuntimeRegistry } from '../runtime/registry'
import { sseAggregator } from '../services/sse-aggregator'
import { logger } from '../utils/logger'
import { getAgentByIdOrSlug } from '../db/subpolar-agents'

type StoredToolState = Record<string, unknown>

type StoredToolPart = {
  callID: string
  tool: string
  state: StoredToolState
}

type StoredAssistantPart =
  | { type: 'text'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string; time: { start: number } }
  | { type: 'tool'; id: string; callID: string; tool: string; state: StoredToolState }

export function createSessionRoutes(db: Database, runtimeRegistry?: RuntimeRegistry) {
  const app = new Hono()

  app.get('/', async (c) => {
    const directory = c.req.query('directory')
    const sessions = directory
      ? await listSessionRecordsByDirectory(db, directory)
      : await listSessionRecords(db)
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
    const body = await c.req.json().catch(() => ({})) as { role?: unknown; content?: unknown; metadata?: unknown; createdAt?: unknown }
    const role = body.role === 'assistant' || body.role === 'system' || body.role === 'tool' ? body.role : 'user'
    const content = typeof body.content === 'string' ? body.content : ''
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : {}
    const createdAt = typeof body.createdAt === 'number' && Number.isFinite(body.createdAt) ? body.createdAt : undefined
    const message = await createMessage(db, { sessionId: c.req.param('id'), role, content, metadata, createdAt })
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
            ...getUserMessageInfoMetadata(role, metadata),
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

    const body = await c.req.json().catch(() => ({})) as { agentId?: unknown; runtime?: unknown; projectId?: unknown; model?: unknown; permissionOverride?: unknown; requestedAt?: unknown }
    const agentId = typeof body.agentId === 'string' ? body.agentId : 'default'
    const model = body.model && typeof body.model === 'object' ? body.model as Record<string, unknown> : undefined
    const requestedAt = typeof body.requestedAt === 'number' && Number.isFinite(body.requestedAt) ? body.requestedAt : undefined
    const permissionOverride = body.permissionOverride === 'ask' || body.permissionOverride === 'none' || body.permissionOverride === 'allow_all'
      ? body.permissionOverride
      : undefined
    const runtime: RuntimeId = 'pi'
    const directory = c.req.query('directory')
    const metadata = {
      ...(permissionOverride ? { permissionOverride } : {}),
      ...(directory ? { directory } : {}),
    }
    const run = await createRun(db, { sessionId: c.req.param('id'), agentId, runtime, metadata })

    void maybeGenerateSessionTitle(db, runtimeRegistry, c.req.param('id'), model, directory)

    void executeRun(db, runtimeRegistry, run.runId, typeof body.projectId === 'string' ? body.projectId : null, model, directory, requestedAt)
    return c.json({ run }, 201)
  })

  return app
}

async function maybeGenerateSessionTitle(db: Database, runtimeRegistry: RuntimeRegistry, sessionId: string, model?: Record<string, unknown>, directory?: string): Promise<void> {
  try {
    const session = await getSessionRecord(db, sessionId)
    if (!session || session.title) return

    const messages = await listMessages(db, sessionId)
    const firstMessage = messages[0]
    if (messages.length !== 1 || !firstMessage || firstMessage.role !== 'user') return

    const title = await generateSessionTitle(runtimeRegistry, sessionId, firstMessage.content, model, directory)
    if (!title) return

    await upsertSessionRecord(db, { sessionId: session.id, title })
    const updated = await getSessionRecord(db, sessionId)
    if (!updated || !directory) return

    sseAggregator.publish(directory, {
      type: 'session.updated',
      properties: {
        info: {
          id: updated.id,
          title: updated.title ?? null,
          directory: updated.directory ?? '',
          projectID: updated.projectId ?? undefined,
          time: { created: updated.createdAt, updated: updated.updatedAt },
        },
      },
    })
  } catch (error) {
    logger.warn('Auto title generation failed', error)
  }
}

async function generateSessionTitle(runtimeRegistry: RuntimeRegistry, sessionId: string, userMessage: string, model?: Record<string, unknown>, directory?: string): Promise<string | null> {
  let content = ''
  const prompt = `for the following session log, output a brief plain-text title in 3 - 6 words. Do not use markdown formatting, code fences, bullets, headings, or quotes.\n\nUser: ${userMessage}`

  for await (const event of runtimeRegistry.get('pi').run({
    runId: crypto.randomUUID(),
    sessionId,
    agentId: 'session-naming',
    cwd: directory,
    messages: [{
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
    }],
    model,
  })) {
    if (event.type === 'message.delta') content += event.content
    if (event.type === 'run.failed') throw new Error(event.error)
  }

  return cleanSessionTitle(content)
}

function cleanSessionTitle(content: string): string | null {
  const title = content
    .trim()
    .replace(/^title:\s*/i, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^\s*[-*+]\s*/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!title) return null
  return title.split(/\s+/).slice(0, 6).join(' ')
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

function getAssistantModelId(eventModel: string | undefined, currentModelId: string | undefined): string | undefined {
  if (!eventModel) return currentModelId
  if (eventModel.includes('/') || !currentModelId) return eventModel
  const providerId = currentModelId.split('/')[0]
  return providerId ? `${providerId}/${eventModel}` : eventModel
}

function getUserMessageInfoMetadata(role: string, metadata: Record<string, unknown>) {
  if (role !== 'user') return {}
  return {
    ...(typeof metadata.agent === 'string' ? { agent: metadata.agent } : {}),
    ...(metadata.model && typeof metadata.model === 'object' ? { model: metadata.model } : {}),
    ...(typeof metadata.permission === 'string' ? { permission: metadata.permission } : {}),
  }
}

function recordToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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

async function executeRun(db: Database, runtimeRegistry: RuntimeRegistry, runId: string, projectId: string | null, model?: Record<string, unknown>, directory?: string, requestedAt?: number): Promise<void> {
  const run = await getRun(db, runId)
  if (!run) return
  const agent = await getAgentByIdOrSlug(db, run.agentId)

  await updateRunStatus(db, runId, 'running')
  const messages = await listMessages(db, run.sessionId)
  const assistantMessageId = crypto.randomUUID()
  const assistantCreatedAt = requestedAt ?? Date.now()
  let assistantCompletedAt: number | null = null
  let assistantModelId = getModelId(model)
  let assistantFinishReason = 'stop'
  let assistantUsage = createEmptyUsage()
  let assistantContent = ''
  let reasoningContent = ''
  let assistantMessageStarted = false
  const assistantParts: StoredAssistantPart[] = []
  let assistantTextPartIndex = 0
  let reasoningPartIndex = 0
  let currentTextPartId: string | null = null
  let currentReasoningPartId: string | null = null
  let currentTextSegmentContent = ''
  let currentReasoningSegmentContent = ''
  let currentReasoningPartStart = assistantCreatedAt
  let assistantTextPartNeedsSplit = false
  let reasoningPartNeedsSplit = false
  const toolParts = new Map<string, StoredToolPart>()

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

  const upsertAssistantPart = (part: StoredAssistantPart) => {
    const index = assistantParts.findIndex((entry) => entry.id === part.id)
    if (index >= 0) {
      assistantParts[index] = part
      return
    }
    assistantParts.push(part)
  }

  const openTextPart = () => {
    currentTextPartId = `${assistantMessageId}-text-${assistantTextPartIndex++}`
    currentTextSegmentContent = ''
    assistantTextPartNeedsSplit = false
    const part = {
      id: currentTextPartId,
      sessionID: run.sessionId,
      messageID: assistantMessageId,
      type: 'text' as const,
      text: '',
    }
    upsertAssistantPart({ type: 'text', id: part.id, text: part.text })
    publish({
      type: 'message.part.updated',
      properties: {
        part,
      },
    })
  }

  const openReasoningPart = () => {
    currentReasoningPartId = `${assistantMessageId}-reasoning-${reasoningPartIndex++}`
    currentReasoningSegmentContent = ''
    reasoningPartNeedsSplit = false
    currentReasoningPartStart = Date.now()
    const part = {
      id: currentReasoningPartId,
      sessionID: run.sessionId,
      messageID: assistantMessageId,
      type: 'reasoning' as const,
      text: '',
      time: { start: currentReasoningPartStart },
    }
    upsertAssistantPart({ type: 'reasoning', id: part.id, text: part.text, time: part.time })
    publish({
      type: 'message.part.updated',
      properties: {
        part,
      },
    })
  }

  const finishAssistantMessage = async () => {
    if (!assistantContent && !reasoningContent && toolParts.size === 0) return
    await createMessage(db, {
      sessionId: run.sessionId,
      role: 'assistant',
      content: assistantContent,
      metadata: {
        runId,
        reasoning: reasoningContent,
        assistantParts,
        completedAt: assistantCompletedAt ?? Date.now(),
        modelID: assistantModelId,
        finishReason: assistantFinishReason,
        usage: assistantUsage,
        tools: [...toolParts.values()],
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

  const publishToolPart = (toolPart: StoredToolPart) => {
    publishAssistantMessageStarted()
    publish({
      type: 'message.part.updated',
      properties: {
        part: {
          id: `${assistantMessageId}-tool-${toolPart.callID}`,
          sessionID: run.sessionId,
          messageID: assistantMessageId,
          type: 'tool',
          callID: toolPart.callID,
          tool: toolPart.tool,
          state: toolPart.state,
        },
      },
    })
  }

  const markContentBoundary = () => {
    assistantTextPartNeedsSplit = true
    reasoningPartNeedsSplit = true
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
      cwd: directory,
      messages,
      model,
      systemPrompt: agent?.prompt,
      skillAccess: agent?.skillAccess.length ? agent.skillAccess : agent?.skills.map(id => ({ id, discovery: 'description' as const })),
    })) {
      await writeRuntimeEvent(db, { runId, sessionId: run.sessionId, event })
      if (event.type === 'message.delta') {
        assistantContent += event.content
        publishAssistantMessageStarted()
        if (currentTextPartId === null || assistantTextPartNeedsSplit) {
          openTextPart()
        }
        const textPartId = currentTextPartId
        if (!textPartId) continue
        currentTextSegmentContent += event.content
        upsertAssistantPart({ type: 'text', id: textPartId, text: currentTextSegmentContent })
        publish({
          type: 'message.part.delta',
          properties: {
            sessionID: run.sessionId,
            messageID: assistantMessageId,
            partID: textPartId,
            field: 'text',
            delta: event.content,
          },
        })
      }
      if (event.type === 'message.reasoning.delta') {
        reasoningContent += event.content
        publishAssistantMessageStarted()
        if (currentReasoningPartId === null || reasoningPartNeedsSplit) {
          openReasoningPart()
        }
        const reasoningPartId = currentReasoningPartId
        if (!reasoningPartId) continue
        currentReasoningSegmentContent += event.content
        upsertAssistantPart({ type: 'reasoning', id: reasoningPartId, text: currentReasoningSegmentContent, time: { start: currentReasoningPartStart } })
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
        assistantModelId = getAssistantModelId(event.model, assistantModelId)
        assistantFinishReason = event.reason ?? assistantFinishReason
        assistantUsage = event.usage ? normalizeUsage(event.usage) : assistantUsage
      }
      if (event.type === 'tool.requested') {
        markContentBoundary()
        const state = {
          status: 'running',
          input: asRecord(event.input),
          time: { start: Date.now() },
        }
        const toolPart = { callID: event.toolCallId, tool: event.toolName, state }
        toolParts.set(event.toolCallId, toolPart)
        upsertAssistantPart({
          type: 'tool',
          id: `${assistantMessageId}-tool-${toolPart.callID}`,
          callID: toolPart.callID,
          tool: toolPart.tool,
          state: toolPart.state,
        })
        publishToolPart(toolPart)
      }
      if (event.type === 'tool.updated') {
        markContentBoundary()
        const existing = toolParts.get(event.toolCallId)
        if (existing) {
          existing.state = {
            ...existing.state,
            metadata: {
              ...asRecord(existing.state.metadata),
              output: recordToString(event.output),
            },
          }
          upsertAssistantPart({
            type: 'tool',
            id: `${assistantMessageId}-tool-${existing.callID}`,
            callID: existing.callID,
            tool: existing.tool,
            state: existing.state,
          })
          publishToolPart(existing)
        }
      }
      if (event.type === 'tool.completed') {
        markContentBoundary()
        const existing = toolParts.get(event.toolCallId) ?? { callID: event.toolCallId, tool: event.toolName ?? 'unknown', state: { input: asRecord(event.input), time: { start: Date.now() } } }
        existing.state = {
          status: 'completed',
          input: asRecord(existing.state.input),
          output: recordToString(event.output),
          title: existing.tool,
          metadata: asRecord(existing.state.metadata),
          time: { start: Number(asRecord(existing.state.time).start ?? Date.now()), end: Date.now() },
        }
        toolParts.set(event.toolCallId, existing)
        upsertAssistantPart({
          type: 'tool',
          id: `${assistantMessageId}-tool-${existing.callID}`,
          callID: existing.callID,
          tool: existing.tool,
          state: existing.state,
        })
        publishToolPart(existing)
      }
      if (event.type === 'tool.failed') {
        markContentBoundary()
        const existing = toolParts.get(event.toolCallId) ?? { callID: event.toolCallId, tool: event.toolName ?? 'unknown', state: { input: asRecord(event.input), time: { start: Date.now() } } }
        existing.state = {
          status: 'error',
          input: asRecord(existing.state.input),
          error: event.error,
          metadata: asRecord(existing.state.metadata),
          time: { start: Number(asRecord(existing.state.time).start ?? Date.now()), end: Date.now() },
        }
        toolParts.set(event.toolCallId, existing)
        upsertAssistantPart({
          type: 'tool',
          id: `${assistantMessageId}-tool-${existing.callID}`,
          callID: existing.callID,
          tool: existing.tool,
          state: existing.state,
        })
        publishToolPart(existing)
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
