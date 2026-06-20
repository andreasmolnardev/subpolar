import { z } from 'zod'

export const AgentModeSchema = z.enum(['primary', 'subagent'])
export const AgentSourceSchema = z.enum(['system', 'user'])

export const AgentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  mode: AgentModeSchema,
  prompt: z.string(),
  permission: z.record(z.string(), z.unknown()),
  skills: z.array(z.string()),
  enabled: z.boolean(),
  source: AgentSourceSchema,
  sort_order: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
})

export const ToolAdapterTypeSchema = z.enum(['internal', 'mcp', 'openapi', 'http', 'custom'])
export const ToolRiskSchema = z.enum(['read', 'write', 'delete', 'external'])

export const JsonSchemaSchema = z.record(z.string(), z.unknown())

export const ToolDefinitionSchema = z.object({
  id: z.string().optional(),
  tool_id: z.string(),
  namespace: z.string(),
  description: z.string(),
  adapter: ToolAdapterTypeSchema,
  target: z.string(),
  operation: z.string(),
  input_schema: JsonSchemaSchema,
  output_schema: JsonSchemaSchema.optional().default({}),
  risk: ToolRiskSchema,
  requires_approval: z.boolean(),
  enabled: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  created_at: z.number(),
  updated_at: z.number(),
})

export const AgentToolPolicySchema = z.object({
  id: z.string().optional(),
  agent_id: z.string(),
  tool_id: z.string(),
  effect: z.enum(['allow', 'deny', 'approval']),
  constraints: z.record(z.string(), z.unknown()).optional().default({}),
  created_at: z.number(),
  updated_at: z.number(),
})

export const ToolListRequestSchema = z.object({
  agentId: z.string(),
  sessionId: z.string().optional(),
})

export const ToolDescribeRequestSchema = z.object({
  agentId: z.string(),
  toolId: z.string(),
  sessionId: z.string().optional(),
})

export const ToolCallRequestSchema = z.object({
  agentId: z.string(),
  toolId: z.string(),
  input: z.unknown().optional().default({}),
  sessionId: z.string().optional(),
})

export const ToolCallResponseSchema = z.union([
  z.object({ ok: z.literal(true), toolId: z.string(), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    toolId: z.string(),
    approvalRequired: z.boolean().optional(),
    approvalId: z.string().optional(),
    message: z.string().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  }),
])

export const ToolApprovalSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  session_id: z.string().optional(),
  tool_id: z.string(),
  input: z.unknown(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']),
  reason: z.string(),
  created_at: z.number(),
  resolved_at: z.number().optional(),
})

export const ToolAuditRecordSchema = z.object({
  id: z.string().optional(),
  agent_id: z.string(),
  session_id: z.string().optional(),
  tool_id: z.string(),
  input: z.unknown(),
  status: z.enum(['success', 'error', 'approval_required', 'denied']),
  result_summary: z.string().optional(),
  error_code: z.string().optional(),
  approval_id: z.string().optional(),
  created_at: z.number(),
})

export const IntegrationTypeSchema = z.enum(['mcp', 'caldav', 'imap_smtp'])

export const IntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: IntegrationTypeSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  secret_ref: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  created_at: z.number(),
  updated_at: z.number(),
})

export const ApprovalRespondRequestSchema = z.object({
  approvalId: z.string(),
  response: z.enum(['approved', 'rejected']),
})
