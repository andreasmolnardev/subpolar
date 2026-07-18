import { Hono } from 'hono'
import { z } from 'zod'
import { AgentSkillAccessSchema } from '@subpolar/shared'
import type { Database } from '../db/schema'
import { logger } from '../utils/logger'
import {
  createUserAgent,
  deleteAgent,
  getAgentByIdOrSlug,
  listAgents,
  updateAgent,
} from '../db/subpolar-agents'

const AgentRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().default(''),
  mode: z.enum(['primary', 'subagent']),
  prompt: z.string().min(1),
  systemPrompt: z.string().default(''),
  permission: z.record(z.string(), z.unknown()).default({}),
  skills: z.array(z.string()).default([]),
  skillAccess: z.array(AgentSkillAccessSchema).default([]),
  enabled: z.boolean().default(true),
  sort_order: z.number().default(0),
})

const AgentUpdateSchema = AgentRequestSchema.partial()

function pocketBaseErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { error }
  const value = error as Record<string, unknown>
  const response = value.response
  return {
    name: value.name,
    message: value.message,
    status: value.status,
    url: value.url,
    response,
    originalError: value.originalError,
  }
}

export function createAgentRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    return c.json(await listAgents(db))
  })

  app.get('/:identifier', async (c) => {
    const agent = await getAgentByIdOrSlug(db, c.req.param('identifier'))
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    return c.json(agent)
  })

  app.post('/', async (c) => {
    try {
      const { skillAccess, ...request } = AgentRequestSchema.parse(await c.req.json())
      return c.json(await createUserAgent(db, { ...request, skill_access: skillAccess, source: 'user' } as never))
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid agent data', details: error.issues }, 400)
      logger.error('PocketBase failed to create agent record', pocketBaseErrorDetails(error))
      return c.json({ error: error instanceof Error ? error.message : 'Failed to create agent' }, 400)
    }
  })

  app.put('/:identifier', async (c) => {
    try {
      const { skillAccess, ...request } = AgentUpdateSchema.parse(await c.req.json())
      const agent = await updateAgent(db, c.req.param('identifier'), { ...request, ...(skillAccess ? { skill_access: skillAccess } : {}) } as never)
      if (!agent) return c.json({ error: 'Agent not found' }, 404)
      return c.json(agent)
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ error: 'Invalid agent data', details: error.issues }, 400)
      logger.error('PocketBase failed to update agent record', pocketBaseErrorDetails(error))
      return c.json({ error: error instanceof Error ? error.message : 'Failed to update agent' }, 400)
    }
  })

  app.delete('/:identifier', async (c) => {
    const deleted = await deleteAgent(db, c.req.param('identifier'))
    if (!deleted) return c.json({ error: 'Agent not found' }, 404)
    return c.json({ success: true })
  })

  return app
}
