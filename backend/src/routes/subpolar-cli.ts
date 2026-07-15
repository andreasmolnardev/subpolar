import { Hono } from 'hono'
import { ApprovalRespondRequestSchema, ToolCallRequestSchema, ToolDescribeRequestSchema, ToolListRequestSchema } from '@subpolar/shared/schemas'
import type { Database } from '../db/schema'
import { createInternalTokenMiddleware } from '../auth/internal-token-middleware'
import { ToolGateway } from '../tools/gateway'
import { discoverMcpTools } from '../services/mcp'
import { discoverOpenApiTools } from '../services/openapi'
import { listEnabledIntegrationsByType } from '../db/integrations'

function resolveAgentId(agentId: string | undefined): string | null {
  return agentId ?? process.env.SUBPOLAR_AGENT_ID ?? null
}

export function createSubpolarCliRoutes(db: Database): Hono {
  const app = new Hono()
  const toolGateway = new ToolGateway(db)
  app.use('/*', createInternalTokenMiddleware(db))

  app.post('/tools/list', async (c) => {
    const parsed = ToolListRequestSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: parsed.error.message } }, 400)
    const agentId = resolveAgentId(parsed.data.agentId)
    if (!agentId) return c.json({ ok: false, error: { code: 'MISSING_AGENT_ID', message: 'Missing agent id' } }, 400)
    const tools = await toolGateway.list(agentId)
    return c.json({ ok: true, tools })
  })

  app.post('/tools/describe', async (c) => {
    const parsed = ToolDescribeRequestSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: parsed.error.message } }, 400)
    const agentId = resolveAgentId(parsed.data.agentId)
    if (!agentId) return c.json({ ok: false, error: { code: 'MISSING_AGENT_ID', message: 'Missing agent id' } }, 400)
    const tool = await toolGateway.describe(agentId, parsed.data.toolId)
    if (!tool) return c.json({ ok: false, toolId: parsed.data.toolId, error: { code: 'UNKNOWN_TOOL', message: 'Tool is unavailable for this agent' } }, 404)
    return c.json({ ok: true, tool })
  })

  app.post('/tools/call', async (c) => {
    const parsed = ToolCallRequestSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: parsed.error.message } }, 400)
    const agentId = resolveAgentId(parsed.data.agentId)
    if (!agentId) return c.json({ ok: false, error: { code: 'MISSING_AGENT_ID', message: 'Missing agent id' } }, 400)
    const result = await toolGateway.call({ agentId, toolId: parsed.data.toolId, toolInput: parsed.data.input, sessionId: parsed.data.sessionId })
    return c.json(result, result.ok ? 200 : 400)
  })

  app.post('/mcp/search', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string; sessionId?: string; query?: unknown }
    const agentId = resolveAgentId(body.agentId)
    if (!agentId) return c.json({ ok: false, error: { code: 'MISSING_AGENT_ID', message: 'Missing agent id' } }, 400)
    const servers = await listEnabledIntegrationsByType(db, 'mcp')
    const failures: Array<{ serverId: string; error: string }> = []
    for (const server of servers) {
      try { await discoverMcpTools(db, server.id, body.sessionId) } catch (error) { failures.push({ serverId: server.id, error: error instanceof Error ? error.message : 'MCP discovery failed' }) }
    }
    const query = typeof body.query === 'string' ? body.query.toLowerCase() : ''
    const tools = (await toolGateway.list(agentId)).filter(tool => tool.id.startsWith('mcp.') && (!query || `${tool.id} ${tool.description}`.toLowerCase().includes(query)))
    return c.json({ ok: true, tools, failures })
  })

  app.post('/mcp/load', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string; serverId?: string; toolId?: string; sessionId?: string }
    const agentId = resolveAgentId(body.agentId)
    if (!agentId || !body.serverId || !body.toolId) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'agentId, serverId, and toolId are required' } }, 400)
    await discoverMcpTools(db, body.serverId, body.sessionId)
    const tool = await toolGateway.describe(agentId, body.toolId)
    return tool ? c.json({ ok: true, tool }) : c.json({ ok: false, error: { code: 'UNKNOWN_TOOL', message: 'MCP tool is unavailable for this agent' } }, 404)
  })

  app.post('/mcp/run', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string; serverId?: string; toolId?: string; input?: unknown; sessionId?: string }
    const agentId = resolveAgentId(body.agentId)
    if (!agentId || !body.serverId || !body.toolId || !body.toolId.startsWith(`mcp.${encodeURIComponent(body.serverId)}.`)) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'A matching agentId, serverId, and MCP toolId are required' } }, 400)
    const result = await toolGateway.call({ agentId, toolId: body.toolId, toolInput: body.input ?? {}, sessionId: body.sessionId })
    return c.json(result, result.ok ? 200 : 400)
  })

  app.post('/openapi/search', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string; query?: unknown }
    const agentId = resolveAgentId(body.agentId)
    if (!agentId) return c.json({ ok: false, error: { code: 'MISSING_AGENT_ID', message: 'Missing agent id' } }, 400)
    const query = typeof body.query === 'string' ? body.query.toLowerCase() : ''
    const tools = (await toolGateway.list(agentId)).filter(tool => tool.id.startsWith('openapi.') && (!query || `${tool.id} ${tool.description}`.toLowerCase().includes(query)))
    return c.json({ ok: true, tools })
  })

  app.post('/openapi/load', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string; serverId?: string; toolId?: string }
    const agentId = resolveAgentId(body.agentId)
    if (!agentId || !body.serverId || !body.toolId) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'agentId, serverId, and toolId are required' } }, 400)
    await discoverOpenApiTools(db, body.serverId)
    const tool = await toolGateway.describe(agentId, body.toolId)
    return tool ? c.json({ ok: true, tool }) : c.json({ ok: false, error: { code: 'UNKNOWN_TOOL', message: 'OpenAPI tool is unavailable for this agent' } }, 404)
  })

  app.post('/openapi/run', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string; serverId?: string; toolId?: string; input?: unknown; sessionId?: string }
    const agentId = resolveAgentId(body.agentId)
    if (!agentId || !body.serverId || !body.toolId || !body.toolId.startsWith('openapi.')) return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'A matching agentId, serverId, and OpenAPI toolId are required' } }, 400)
    const result = await toolGateway.call({ agentId, toolId: body.toolId, toolInput: body.input ?? {}, sessionId: body.sessionId })
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
