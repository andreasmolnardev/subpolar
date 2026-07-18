import { Hono } from 'hono'
import { getPiProviders } from '../runtime/pi/models'
import type { Database } from '../db/schema'
import { listPendingApprovals, respondToApproval, type ToolApprovalRecord } from '../db/subpolar-tools'

function toPermissionRequest(approval: ToolApprovalRecord) {
  return {
    id: approval.id,
    sessionID: approval.session_id ?? '',
    permission: approval.tool_id === 'pi.bash' ? 'bash' : approval.tool_id,
    patterns: [approval.tool_id],
    metadata: {
      agentId: approval.agent_id,
      toolId: approval.tool_id,
      input: approval.input,
      reason: approval.reason,
    },
    always: [],
  }
}

export function createRuntimeRoutes(db: Database) {
  const app = new Hono()

  app.get('/config', async (c) => c.json({
    runtime: 'pi',
    model: null,
    small_model: null,
    provider: {},
  }))

  app.patch('/config', async (c) => c.json(await c.req.json().catch(() => ({}))))

  app.get('/provider', async (c) => c.json(await getPiProviders()))
  app.get('/config/providers', async (c) => {
    const providers = await getPiProviders()
    return c.json({ providers: providers.all, default: providers.default })
  })
  app.get('/command', async (c) => c.json([]))
  app.get('/permission', async (c) => {
    const sessionId = c.req.query('sessionID') ?? c.req.query('sessionId')
    const approvals = await listPendingApprovals(db, sessionId)
    return c.json(approvals.map(toPermissionRequest))
  })
  app.post('/session/:sessionID/permissions/:permissionID', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { response?: unknown }
    const response = body.response === 'once' || body.response === 'always' ? 'approved' : 'rejected'
    const approval = await respondToApproval(db, c.req.param('permissionID'), response === 'approved')
    return c.json({ sessionID: c.req.param('sessionID'), permissionID: approval.id, response: body.response })
  })
  app.get('/question', async (c) => c.json([]))
  app.get('/lsp', async (c) => c.json([]))

  return app
}
