import { callTool } from '../services/subpolar-tool-router'
import type { Database } from '../db/schema'
import { getRun } from '../db/runs'
import type { ToolPermissionOverride } from '../services/subpolar-tool-router'

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
    return {
      ok: false,
      decision: 'approval',
      approvalId: result.approvalId,
      message: result.message,
    }
  }
  return { ok: false, decision: 'deny', message: result.error?.message ?? 'Pi tool call was denied' }
}
