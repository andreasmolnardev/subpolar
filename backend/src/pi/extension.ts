type PiToolAuthorizationRequest = {
  agentId: string
  sessionId: string
  runId: string
  toolCallId: string
  toolName: string
  input: unknown
  cwd?: string
}

type PiToolAuthorizationResponse =
  | { ok: true; decision: 'allow' }
  | { ok: false; decision: 'deny' | 'approval'; message?: string }

type PiToolCall = {
  id?: unknown
  toolCallId?: unknown
  name?: unknown
  toolName?: unknown
  input?: unknown
  args?: unknown
  cwd?: unknown
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function toolCallValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export function createAuthorizationRequest(toolCall: PiToolCall): PiToolAuthorizationRequest {
  return {
    agentId: requiredEnv('SUBPOLAR_AGENT_ID'),
    sessionId: requiredEnv('SUBPOLAR_SESSION_ID'),
    runId: requiredEnv('SUBPOLAR_RUN_ID'),
    toolCallId: toolCallValue(toolCall.toolCallId ?? toolCall.id, crypto.randomUUID()),
    toolName: toolCallValue(toolCall.toolName ?? toolCall.name, 'unknown'),
    input: toolCall.input ?? toolCall.args ?? {},
    cwd: typeof toolCall.cwd === 'string' ? toolCall.cwd : undefined,
  }
}

export async function authorizeToolCall(toolCall: PiToolCall): Promise<void | { block: true; reason: string }> {
  let request: PiToolAuthorizationRequest
  try {
    request = createAuthorizationRequest(toolCall)
  } catch (error) {
    return { block: true, reason: error instanceof Error ? error.message : 'Pi tool authorization is not configured' }
  }

  try {
    const baseUrl = requiredEnv('SUBPOLAR_BASE_URL').replace(/\/+$/, '')
    const token = requiredEnv('SUBPOLAR_INTERNAL_TOKEN')
    const response = await fetch(`${baseUrl}/api/pi/tools/authorize`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    })
    if (!response.ok) return { block: true, reason: `Subpolar authorization failed with HTTP ${response.status}` }

    const result = await response.json() as PiToolAuthorizationResponse
    if (result.ok && result.decision === 'allow') return undefined
    return { block: true, reason: result.message ?? `Subpolar blocked ${request.toolName}` }
  } catch (error) {
    return { block: true, reason: error instanceof Error ? error.message : 'Subpolar authorization failed' }
  }
}

export default function subpolarPiExtension(pi: { hook?: (name: string, handler: (event: unknown) => unknown) => void; on?: (name: string, handler: (event: unknown) => unknown) => void }) {
  const register = pi.hook ?? pi.on
  if (!register) return
  register.call(pi, 'project_trust', () => ({ trusted: 'no' }))
  register.call(pi, 'tool_call', (event) => authorizeToolCall(event as PiToolCall))
}
