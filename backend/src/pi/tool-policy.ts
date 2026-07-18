import { callTool } from '../services/subpolar-tool-router'
import type { Database } from '../db/schema'
import { getRun } from '../db/runs'
import type { ToolPermissionOverride } from '../services/subpolar-tool-router'
import { getApproval } from '../db/subpolar-tools'
import { sseAggregator } from '../services/sse-aggregator'

const PI_TOOL_IDS = {
  read: 'pi.read',
  write: 'pi.write',
  edit: 'pi.edit',
  bash: 'pi.bash',
  grep: 'pi.grep',
  find: 'pi.find',
  ls: 'pi.ls',
} as const

export type PiToolName = keyof typeof PI_TOOL_IDS

export type PiToolAuthorizationInput = {
  agentId: string
  sessionId: string
  runId: string
  toolCallId: string
  toolName: string
  input: unknown
  cwd?: string
}

export type PiToolAuthorizationResult =
  | { ok: true; decision: 'allow' }
  | { ok: false; decision: 'deny'; message: string }
  | { ok: false; decision: 'approval'; approvalId: string; message: string }

export function mapPiToolName(toolName: string): string | null {
  return Object.prototype.hasOwnProperty.call(PI_TOOL_IDS, toolName) ? PI_TOOL_IDS[toolName as PiToolName] : null
}

function parsePermissionOverride(value: unknown): ToolPermissionOverride | undefined {
  return value === 'ask' || value === 'none' || value === 'allow_all' ? value : undefined
}

async function waitForApproval(db: Database, approvalId: string): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < 5 * 60 * 1000) {
    const approval = await getApproval(db, approvalId)
    if (approval?.status === 'approved') return true
    if (approval?.status === 'rejected') return false
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

export async function authorizePiToolCall(db: Database, input: PiToolAuthorizationInput): Promise<PiToolAuthorizationResult> {
  const toolId = mapPiToolName(input.toolName)
  if (!toolId) return { ok: false, decision: 'deny', message: `Unknown Pi tool: ${input.toolName}` }
  const run = await getRun(db, input.runId)
  const permissionOverride = parsePermissionOverride(run?.metadata.permissionOverride)

  const result = await callTool(db, input.agentId, toolId, {
    runId: input.runId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    cwd: input.cwd,
    input: input.input,
  }, input.sessionId, permissionOverride)

  if (result.ok) return { ok: true, decision: 'allow' }
  if ('approvalRequired' in result && result.approvalRequired) {
    const directory = typeof run?.metadata.directory === 'string' ? run.metadata.directory : undefined
    if (directory) {
      sseAggregator.publish(directory, {
        type: 'permission.asked',
        properties: {
          id: result.approvalId,
          sessionID: input.sessionId,
          permission: toolId === 'pi.bash' ? 'bash' : toolId,
          patterns: [toolId],
          metadata: { agentId: input.agentId, toolId, toolName: input.toolName, input: input.input, reason: result.message },
          always: [],
        },
      })
    }
    if (await waitForApproval(db, result.approvalId)) return { ok: true, decision: 'allow' }
    return {
      ok: false,
      decision: 'approval',
      approvalId: result.approvalId,
      message: result.message,
    }
  }
  return { ok: false, decision: 'deny', message: result.error?.message ?? 'Pi tool call was denied' }
}
