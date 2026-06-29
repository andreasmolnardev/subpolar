import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { listEnabledAgents } from '../db/subpolar-agents'

export function createAgentRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    const agents = await listEnabledAgents(db)
    return c.json(agents.map(agent => ({
      name: agent.name,
      description: agent.description,
      mode: agent.mode,
    })))
  })

  return app
}
