import { Hono } from 'hono'
import { ApprovalRespondRequestSchema, ToolCallRequestSchema, ToolDescribeRequestSchema, ToolListRequestSchema } from '@subpolar/shared/schemas'
import type { Database } from '../db/schema'
import { createInternalTokenMiddleware } from '../auth/internal-token-middleware'
import { callTool, describeToolForAgent, listToolsForAgent } from '../services/subpolar-tool-router'

export function createSubpolarCliRoutes(db: Database): Hono {
  const app = new Hono()
  app.use('/*', createInternalTokenMiddleware(db))

  app.post('/tools/list', async (c) => {
    const parsed = ToolListRequestSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: parsed.error.message } }, 400)
    const tools = await listToolsForAgent(db, parsed.data.agentId)
    return c.json({ ok: true, tools })
  })

  app.post('/tools/describe', async (c) => {
    const parsed = ToolDescribeRequestSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: parsed.error.message } }, 400)
    const tool = await describeToolForAgent(db, parsed.data.agentId, parsed.data.toolId)
    if (!tool) return c.json({ ok: false, toolId: parsed.data.toolId, error: { code: 'UNKNOWN_TOOL', message: 'Tool is unavailable for this agent' } }, 404)
    return c.json({ ok: true, tool })
  })

  app.post('/tools/call', async (c) => {
    const parsed = ToolCallRequestSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: parsed.error.message } }, 400)
    const result = await callTool(db, parsed.data.agentId, parsed.data.toolId, parsed.data.input, parsed.data.sessionId)
    return c.json(result, result.ok ? 200 : 400)
  })

  app.get('/approvals/pending', async (c) => {
    const records = await db.collection('tool_approvals').getFullList({ filter: 'status = "pending"', sort: '-created_at' })
    return c.json({ ok: true, approvals: records })
  })

  app.post('/approvals/respond', async (c) => {
    const parsed = ApprovalRespondRequestSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: parsed.error.message } }, 400)
    await db.collection('tool_approvals').update(parsed.data.approvalId, { status: parsed.data.response, resolved_at: Date.now() })
    return c.json({ ok: true })
  })

  app.get('/audit', async (c) => {
    const records = await db.collection('tool_call_audit').getFullList({ sort: '-created_at', perPage: 100 })
    return c.json({ ok: true, audit: records })
  })

  return app
}
