import type { Database } from '../db/schema'
import { getEnabledIntegrationForTool, listEnabledIntegrationsByType, updateIntegration } from '../db/integrations'
import { upsertTool } from '../db/subpolar-tools'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export type McpTransportKind = 'stdio' | 'streamable-http'

export type McpServerConfig = {
  transport: McpTransportKind
  command?: string[]
  cwd?: string
  environment?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  timeout?: number
}

type McpSecretValues = Pick<McpServerConfig, 'environment' | 'headers'>

type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> }

type JsonRpcResponse = { id?: number; result?: unknown; error?: { code?: number; message?: string } }

function timeoutFor(config: McpServerConfig): number {
  return Math.min(Math.max(config.timeout ?? 15_000, 1_000), 120_000)
}

function initializationTimeoutFor(config: McpServerConfig): number {
  return Math.max(timeoutFor(config), 60_000)
}

function toolId(serverId: string, name: string): string {
  return `mcp.${encodeURIComponent(serverId)}.${encodeURIComponent(name)}`
}

function riskFor(name: string): 'read' | 'write' | 'delete' | 'external' {
  const value = name.toLowerCase()
  if (/(delete|remove|destroy|drop)/.test(value)) return 'delete'
  if (/(create|update|write|edit|send|publish|deploy)/.test(value)) return 'external'
  if (/(get|list|read|search|find|fetch|query)/.test(value)) return 'read'
  return 'external'
}

function assertConfig(config: McpServerConfig): void {
  if (config.transport === 'stdio') {
    if (!config.command?.length || config.command.some(value => !value.trim())) throw new Error('A non-empty argv command is required for stdio MCP servers')
    return
  }
  if (!config.url) throw new Error('A URL is required for Streamable HTTP MCP servers')
  const url = new URL(config.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('MCP URL must use HTTP or HTTPS')
}

function secretKey(): Buffer {
  const value = process.env.SUBPOLAR_MCP_SECRET_KEY
  if (!value) throw new Error('SUBPOLAR_MCP_SECRET_KEY is required when configuring MCP environment variables or headers')
  return createHash('sha256').update(value).digest()
}

function encryptSecrets(value: McpSecretValues): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

function decryptSecrets(value: string): McpSecretValues {
  const bytes = Buffer.from(value, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as McpSecretValues
}

export async function saveMcpSecrets(db: Database, serverId: string, values: McpSecretValues): Promise<void> {
  if (!Object.keys(values.environment ?? {}).length && !Object.keys(values.headers ?? {}).length) return
  const existing = await db.collection('mcp_secrets').getFirstListItem(`server_id = "${serverId.replaceAll('"', '\\"')}"`).catch(() => null)
  const data = { server_id: serverId, ciphertext: encryptSecrets(values), updated_at: Date.now() }
  if (existing) await db.collection('mcp_secrets').update(String((existing as unknown as { id: string }).id), data)
  else await db.collection('mcp_secrets').create({ ...data, created_at: Date.now() })
}

async function loadMcpSecrets(db: Database, serverId: string): Promise<McpSecretValues> {
  const record = await db.collection('mcp_secrets').getFirstListItem(`server_id = "${serverId.replaceAll('"', '\\"')}"`).catch(() => null)
  return record ? decryptSecrets(String((record as unknown as { ciphertext: string }).ciphertext)) : {}
}

class StdioConnection {
  private readonly decoder = new TextDecoder()
  private readonly pending = new Map<number, { resolve: (value: JsonRpcResponse) => void; reject: (reason: Error) => void }>()
  private nextId = 1
  private buffer = ''
  private process: ReturnType<typeof Bun.spawn> | null = null

  constructor(private readonly config: McpServerConfig) {}

  async initialize(signal?: AbortSignal): Promise<void> {
    assertConfig(this.config)
    const [command, ...args] = this.config.command!
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: process.env.LANG ?? 'en_US.UTF-8', ...this.config.environment }
    this.process = Bun.spawn([command!, ...args], { cwd: this.config.cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    void this.consume()
    await this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'subpolar', version: '1.0.0' } }, signal, initializationTimeoutFor(this.config))
    this.notify('notifications/initialized', {})
  }

  private async consume(): Promise<void> {
    if (!this.process?.stdout) return
    const reader = (this.process.stdout as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        this.buffer += this.decoder.decode(chunk.value, { stream: true })
        let newline = this.buffer.indexOf('\n')
        while (newline !== -1) {
          const line = this.buffer.slice(0, newline).trim()
          this.buffer = this.buffer.slice(newline + 1)
          if (line) this.handle(line)
          newline = this.buffer.indexOf('\n')
        }
      }
    } finally {
      const error = new Error('MCP stdio server closed unexpectedly')
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    }
  }

  private handle(line: string): void {
    const response = JSON.parse(line) as JsonRpcResponse
    if (typeof response.id !== 'number') return
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    pending.resolve(response)
  }

  private notify(method: string, params: unknown): void {
    const stdin = this.process?.stdin as { write: (value: string) => void } | undefined
    stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  async request(method: string, params: unknown, signal?: AbortSignal, timeout = timeoutFor(this.config)): Promise<unknown> {
    if (!this.process) throw new Error('MCP connection is not initialized')
    const id = this.nextId++
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, timeout)
      const abort = () => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`MCP request cancelled: ${method}`))
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(id, { resolve: value => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value) }, reject: error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error) } })
      const stdin = this.process!.stdin as unknown as { write: (value: string) => void }
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
    if (response.error) throw Object.assign(new Error(response.error.message ?? `MCP ${method} failed`), { code: response.error.code })
    return response.result
  }

  close(): void {
    this.process?.kill()
    this.process = null
  }
}

class HttpConnection {
  private sessionId: string | undefined
  constructor(private readonly config: McpServerConfig) {}

  async initialize(signal?: AbortSignal): Promise<void> {
    await this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'subpolar', version: '1.0.0' } }, signal)
    await this.request('notifications/initialized', {}, signal)
  }

  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    assertConfig(this.config)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutFor(this.config))
    signal?.addEventListener('abort', () => controller.abort(), { once: true })
    try {
      const response = await fetch(this.config.url!, {
        method: 'POST',
        signal: controller.signal,
        headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}), ...this.config.headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      if (!response.ok) throw new Error(`MCP server returned HTTP ${response.status}`)
      this.sessionId = response.headers.get('mcp-session-id') ?? this.sessionId
      const body = await response.text()
      const payload = body.startsWith('data:') ? body.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim() : body
      const json = JSON.parse(payload || '{}') as JsonRpcResponse
      if (json.error) throw Object.assign(new Error(json.error.message ?? `MCP ${method} failed`), { code: json.error.code })
      return json.result
    } finally { clearTimeout(timer) }
  }

  close(): void { this.sessionId = undefined }
}

type Connection = StdioConnection | HttpConnection

export class McpConnectionManager {
  private readonly connections = new Map<string, Connection>()

  private async connection(serverId: string, config: McpServerConfig, signal?: AbortSignal): Promise<Connection> {
    let connection = this.connections.get(serverId)
    if (!connection) {
      connection = config.transport === 'stdio' ? new StdioConnection(config) : new HttpConnection(config)
      this.connections.set(serverId, connection)
      try {
        await connection.initialize(signal)
      } catch (error) {
        this.connections.delete(serverId)
        connection.close()
        throw error
      }
    }
    return connection
  }

  async listTools(serverId: string, config: McpServerConfig, signal?: AbortSignal): Promise<McpTool[]> {
    const result = await (await this.connection(serverId, config, signal)).request('tools/list', {}, signal) as { tools?: McpTool[] }
    return Array.isArray(result.tools) ? result.tools : []
  }

  async callTool(serverId: string, config: McpServerConfig, name: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    return (await this.connection(serverId, config, signal)).request('tools/call', { name, arguments: input }, signal)
  }

  close(): void { for (const connection of this.connections.values()) connection.close(); this.connections.clear() }
}

const managers = new Map<string, McpConnectionManager>()

function managerFor(sessionId: string | undefined): McpConnectionManager {
  const key = sessionId ?? 'discovery'
  let manager = managers.get(key)
  if (!manager) { manager = new McpConnectionManager(); managers.set(key, manager) }
  return manager
}

export function closeMcpSession(sessionId: string): void {
  managers.get(sessionId)?.close()
  managers.delete(sessionId)
}

export async function discoverMcpTools(db: Database, serverId: string, sessionId?: string, signal?: AbortSignal): Promise<McpTool[]> {
  const integration = await getMcpServer(db, serverId)
  if (!integration) throw new Error('MCP server is not enabled or does not exist')
  const config = { ...integration.config, ...(await loadMcpSecrets(db, integration.id)) } as McpServerConfig
  assertConfig(config)
  const tools = await managerFor(sessionId).listTools(integration.id, config, signal)
  const activeToolIds = new Set(tools.map(tool => toolId(integration.id, tool.name)))
  const registeredTools = await db.collection('tool_registry').getFullList({ filter: `namespace = "mcp" && target = "${integration.id.replaceAll('"', '\\"')}"` })
  for (const registeredTool of registeredTools) {
    if (!activeToolIds.has(String((registeredTool as unknown as { tool_id: string }).tool_id))) {
      await db.collection('tool_registry').update(String(registeredTool.id), { enabled: false, updated_at: Date.now() })
    }
  }
  for (const tool of tools) {
    const risk = riskFor(tool.name)
    await upsertTool(db, {
      tool_id: toolId(integration.id, tool.name), namespace: 'mcp', description: tool.description ?? tool.name,
      adapter: 'mcp', target: integration.id, operation: tool.name, input_schema: tool.inputSchema ?? { type: 'object', additionalProperties: true }, output_schema: {},
      risk, requires_approval: risk !== 'read', enabled: true,
      metadata: { serverId: integration.id, serverName: integration.name, discovered: true },
    })
  }
  return tools
}

export async function discoverConfiguredMcpTools(db: Database, missingOnly = false): Promise<void> {
  const servers = await listEnabledIntegrationsByType(db, 'mcp')
  for (const server of servers) {
    if (missingOnly) {
      const registeredTools = await db.collection('tool_registry').getFullList({ filter: `namespace = "mcp" && target = "${server.id.replaceAll('"', '\\"')}" && enabled = true` })
      if (registeredTools.length > 0) continue
    }
    try {
      const tools = await discoverMcpTools(db, server.id)
      await updateIntegration(db, server.id, { metadata: { ...server.metadata, toolCount: tools.length, error: '' } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP discovery failed'
      await updateIntegration(db, server.id, { metadata: { ...server.metadata, error: message } })
      throw new Error(`Failed to discover MCP tools for ${server.name}: ${message}`, { cause: error })
    }
  }
}

export async function callMcpTool(db: Database, serverId: string, operation: string, input: unknown, sessionId?: string, signal?: AbortSignal): Promise<unknown> {
  const integration = await getMcpServer(db, serverId)
  if (!integration) throw Object.assign(new Error('MCP server is not enabled or does not exist'), { code: 'INTEGRATION_NOT_CONFIGURED' })
  const config = { ...integration.config, ...(await loadMcpSecrets(db, integration.id)) } as McpServerConfig
  assertConfig(config)
  return managerFor(sessionId).callTool(integration.id, config, operation, input, signal)
}

async function getMcpServer(db: Database, serverId: string) {
  const direct = await getEnabledIntegrationForTool(db, 'mcp', serverId)
  if (direct) return direct
  return (await listEnabledIntegrationsByType(db, 'mcp')).find(server => server.name === serverId) ?? null
}
