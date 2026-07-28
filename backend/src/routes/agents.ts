import { Hono } from 'hono'
import { z } from 'zod'
import { AgentSkillAccessSchema, type AgentToolAccess } from '@subpolar/shared'
import type { Database } from '../db/schema'
import { logger } from '../utils/logger'
import {
  createUserAgent,
  deleteAgent,
  getAgentByIdOrSlug,
  listAgents,
  updateAgent,
} from '../db/subpolar-agents'
import { listPoliciesForAgent } from '../db/subpolar-tools'

function normalizePermission(value: unknown, fallback: AgentToolAccess['permission'] = 'deny'): AgentToolAccess['permission'] {
  return value === 'allow' || value === 'ask' || value === 'deny' ? value : fallback
}

function withToolAccess(agent: Awaited<ReturnType<typeof getAgentByIdOrSlug>>, policies: Awaited<ReturnType<typeof listPoliciesForAgent>>): (NonNullable<typeof agent> & { toolAccess: AgentToolAccess[] }) | null {
  if (!agent) return null
  const permission = agent.permission
  const bashPermissions = permission.bash && typeof permission.bash === 'object' ? permission.bash as Record<string, unknown> : {}
  const bashPolicy = policies.find(policy => policy.tool_id === 'pi.bash')
  const bashPermission = bashPolicy ? normalizePermission(bashPolicy.effect === 'approval' ? 'ask' : bashPolicy.effect) : normalizePermission(permission.bash, 'deny')
  const toolAccess: AgentToolAccess[] = [
    { type: 'builtin', id: 'edit', permission: normalizePermission(permission.edit, 'allow') },
    { type: 'builtin', id: 'webfetch', permission: normalizePermission(permission.webfetch, 'allow') },
    { type: 'builtin', id: 'other-bash', permission: bashPermission },
    ...Object.keys(bashPermissions).filter(command => command !== '*').map(command => ({ type: 'cli' as const, id: command.replace(/ \*$/, ''), command: command.replace(/ \*$/, ''), permission: normalizePermission(bashPermissions[command], 'allow') })),
    ...policies.filter(policy => policy.tool_id !== 'pi.bash').map(policy => ({ type: 'subpolar' as const, id: policy.tool_id, permission: policy.effect === 'approval' ? 'ask' as const : policy.effect })),
  ]
  return { ...agent, toolAccess }
}

const AgentRequestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1).optional(),
  description: z.string().default(''),
  mode: z.enum(['primary', 'subagent']),
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
    return c.json(withToolAccess(agent, await listPoliciesForAgent(db, agent.id)))
  })

  app.post('/', async (c) => {
    try {
      const { skillAccess, ...request } = AgentRequestSchema.parse(await c.req.json())
      return c.json(await createUserAgent(db, { ...request, displayName: request.displayName ?? request.name, skill_access: skillAccess, source: 'user' } as never))
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
