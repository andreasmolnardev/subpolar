import { Hono } from 'hono'
import { z } from 'zod'
import { createInternalTokenMiddleware } from '../auth/internal-token-middleware'
import type { Database } from '../db/schema'
import { authorizePiToolCall } from './tool-policy'

const authorizeToolSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
  cwd: z.string().optional(),
})

export function createPiRoutes(db: Database) {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))

  app.post('/tools/authorize', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = authorizeToolSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ ok: false, decision: 'deny', message: 'Invalid Pi tool authorization request' }, 400)
    }

    const result = await authorizePiToolCall(db, parsed.data)
    return c.json(result)
  })

  return app
}
