#!/usr/bin/env bun

const EXIT = {
  general: 1,
  invalidJson: 2,
  unknownTool: 3,
  permissionDenied: 4,
  validationFailed: 5,
  approvalRequired: 6,
  backend: 7,
} as const

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function fail(code: number, value: unknown): never {
  print(value)
  process.exit(code)
}

function parseArgs(args: string[]): { agentId: string; command: string[] } {
  const index = args.findIndex(arg => arg === '--agentId' || arg.startsWith('--agentId='))
  if (index === -1) fail(EXIT.general, { ok: false, error: { code: 'MISSING_AGENT_ID', message: 'Missing --agentId' } })
  const current = args[index]
  const agentId = current.includes('=') ? current.slice(current.indexOf('=') + 1) : args[index + 1]
  if (!agentId) fail(EXIT.general, { ok: false, error: { code: 'MISSING_AGENT_ID', message: 'Missing --agentId value' } })
  const valueIndex = current.includes('=') ? -1 : index + 1
  const command = args.filter((_, argIndex) => argIndex !== index && argIndex !== valueIndex)
  return { agentId, command }
}

async function readToken(): Promise<string> {
  if (process.env.SUBPOLAR_INTERNAL_TOKEN) return process.env.SUBPOLAR_INTERNAL_TOKEN
  const paths = [
    `${process.cwd()}/.opencode/internal-token`,
    `${process.cwd()}/general-chat/.opencode/internal-token`,
  ]
  for (const path of paths) {
    const file = Bun.file(path)
    if (await file.exists()) return (await file.text()).trim()
  }
  fail(EXIT.general, { ok: false, error: { code: 'MISSING_INTERNAL_TOKEN', message: 'Could not find Subpolar internal token' } })
}

async function post(path: string, body: unknown): Promise<unknown> {
  const baseUrl = process.env.SUBPOLAR_API_BASE_URL ?? 'http://localhost:5003'
  const token = await readToken()
  const response = await fetch(`${baseUrl}/api/subpolar-cli${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch(error => fail(EXIT.backend, { ok: false, error: { code: 'BACKEND_UNAVAILABLE', message: String(error) } }))
  const json = await response.json().catch(() => ({ ok: false, error: { code: 'BAD_BACKEND_RESPONSE', message: 'Backend returned non-JSON response' } }))
  return json
}

function exitForResponse(response: unknown): number {
  if (!response || typeof response !== 'object') return EXIT.backend
  const object = response as { ok?: unknown; approvalRequired?: unknown; error?: { code?: string } }
  if (object.ok === true) return 0
  if (object.approvalRequired) return EXIT.approvalRequired
  if (object.error?.code === 'UNKNOWN_TOOL') return EXIT.unknownTool
  if (object.error?.code === 'PERMISSION_DENIED') return EXIT.permissionDenied
  if (object.error?.code === 'VALIDATION_FAILED') return EXIT.validationFailed
  return EXIT.backend
}

const { agentId, command } = parseArgs(process.argv.slice(2))

if (command[0] === 'tools' && command[1] === 'list') {
  const response = await post('/tools/list', { agentId })
  print(response)
  process.exit(exitForResponse(response))
}

const toolId = command[0]
if (!toolId) fail(EXIT.general, { ok: false, error: { code: 'MISSING_COMMAND', message: 'Expected tools list or a tool id' } })

if (command[1] === '--help') {
  const response = await post('/tools/describe', { agentId, toolId })
  print(response)
  process.exit(exitForResponse(response))
}

let input: unknown = {}
if (command[1]) {
  try {
    input = JSON.parse(command[1])
  } catch {
    fail(EXIT.invalidJson, { ok: false, toolId, error: { code: 'INVALID_JSON', message: 'Tool input must be valid JSON' } })
  }
}

const response = await post('/tools/call', { agentId, toolId, input })
print(response)
process.exit(exitForResponse(response))
