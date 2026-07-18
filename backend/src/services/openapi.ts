import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Database } from '../db/schema'
import { getEnabledIntegrationForTool, listEnabledIntegrationsByType, updateIntegration } from '../db/integrations'
import { upsertTool } from '../db/subpolar-tools'
import { normalizeToolName, qualifiedToolId } from './tool-naming'

type JsonObject = Record<string, unknown>
type AuthType = 'spec' | 'none' | 'apiKey' | 'bearer' | 'basic' | 'headers'

export type OpenApiConfig = {
  providerName: string
  document: string
  serverUrl?: string
  timeout?: number
  authType?: AuthType
  authKeyName?: string
  authPlacement?: 'header' | 'query' | 'cookie'
}

type OpenApiSecrets = {
  authValue?: string
  authUsername?: string
  authPassword?: string
  headers?: Record<string, string>
}

type OpenApiOperation = {
  toolId: string
  subtool: string
  method: string
  path: string
  description: string
  inputSchema: JsonObject
  security: unknown
}

function secretKey(): Buffer {
  const value = process.env.SUBPOLAR_MCP_SECRET_KEY
  if (!value) throw new Error('SUBPOLAR_MCP_SECRET_KEY is required when configuring OpenAPI authentication')
  return createHash('sha256').update(value).digest()
}

function encrypt(value: OpenApiSecrets): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

function decrypt(value: string): OpenApiSecrets {
  const bytes = Buffer.from(value, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as OpenApiSecrets
}

export async function saveOpenApiSecrets(db: Database, serverId: string, values: OpenApiSecrets): Promise<void> {
  if (!values.authValue && !values.authUsername && !values.authPassword && !Object.keys(values.headers ?? {}).length) return
  const existing = await db.collection('openapi_secrets').getFirstListItem(`server_id = "${serverId.replaceAll('"', '\\"')}"`).catch(() => null)
  const data = { server_id: serverId, ciphertext: encrypt(values), updated_at: Date.now() }
  if (existing) await db.collection('openapi_secrets').update(String((existing as unknown as { id: string }).id), data)
  else await db.collection('openapi_secrets').create({ ...data, created_at: Date.now() })
}

async function loadSecrets(db: Database, serverId: string): Promise<OpenApiSecrets> {
  const record = await db.collection('openapi_secrets').getFirstListItem(`server_id = "${serverId.replaceAll('"', '\\"')}"`).catch(() => null)
  return record ? decrypt(String((record as unknown as { ciphertext: string }).ciphertext)) : {}
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OpenAPI document must be a JSON object')
  return value as JsonObject
}

export function normalizeProviderName(value: string): string {
  return normalizeToolName(value)
}

function parseDocument(value: string): JsonObject {
  let document: JsonObject
  try { document = object(JSON.parse(value)) } catch { throw new Error('OpenAPI JSON is invalid') }
  const version = document.openapi
  if (typeof version !== 'string' || !/^3\.(0|1)(?:\.|$)/.test(version)) throw new Error('Only OpenAPI 3.0 and 3.1 JSON documents are supported')
  if (!document.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) throw new Error('OpenAPI document must contain paths')
  return document
}

function resolveRef(document: JsonObject, value: unknown): JsonObject {
  const current = object(value)
  if (typeof current.$ref !== 'string') return current
  if (!current.$ref.startsWith('#/')) throw new Error('External OpenAPI references are not supported')
  const target = current.$ref.slice(2).split('/').reduce<unknown>((node, key) => object(node)[key.replace(/~1/g, '/').replace(/~0/g, '~')], document)
  return object(target)
}

function operationName(method: string, path: string, operation: JsonObject): string {
  if (typeof operation.operationId === 'string' && /^[A-Za-z0-9._-]+$/.test(operation.operationId)) return operation.operationId
  return `${method}-${path.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root'}`
}

function parameterSchema(document: JsonObject, values: unknown): JsonObject {
  const properties: JsonObject = {}
  const required: string[] = []
  for (const parameterValue of Array.isArray(values) ? values : []) {
    const parameter = resolveRef(document, parameterValue)
    const location = parameter.in
    const name = parameter.name
    if (!['path', 'query', 'header', 'cookie'].includes(String(location)) || typeof name !== 'string') continue
    const locationName = String(location)
    const group = properties[locationName] as JsonObject | undefined ?? { type: 'object', properties: {}, additionalProperties: false }
    const groupProperties = group.properties as JsonObject
    groupProperties[name] = parameter.schema && typeof parameter.schema === 'object' ? parameter.schema : { type: 'string' }
    if (parameter.required === true || location === 'path') {
      const groupRequired = Array.isArray(group.required) ? group.required as string[] : []
      group.required = [...groupRequired, name]
      if (!required.includes(locationName)) required.push(locationName)
    }
    properties[locationName] = group
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

function inputSchema(document: JsonObject, pathItem: JsonObject, operation: JsonObject): JsonObject {
  const schema = parameterSchema(document, [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])])
  const requestBody = operation.requestBody ? resolveRef(document, operation.requestBody) : null
  const content = requestBody && object(requestBody.content ?? {})['application/json']
  if (content && typeof content === 'object') {
    const body = object(content)
    ;(schema.properties as JsonObject).body = body.schema && typeof body.schema === 'object' ? resolveRef(document, body.schema) : { type: 'object', additionalProperties: true }
    if (requestBody?.required === true) schema.required = [...(schema.required as string[]), 'body']
  }
  return schema
}

function risk(method: string): 'read' | 'external' | 'delete' {
  if (['get', 'head', 'options'].includes(method)) return 'read'
  if (method === 'delete') return 'delete'
  return 'external'
}

function serverUrl(document: JsonObject, operation: JsonObject, config: OpenApiConfig): string {
  const pick = (value: unknown) => Array.isArray(value) && value[0] && typeof value[0] === 'object' ? object(value[0]).url : undefined
  const raw = config.serverUrl || pick(operation.servers) || pick(document.servers)
  if (typeof raw !== 'string' || !raw) throw new Error('An OpenAPI server URL or server URL override is required')
  const expanded = raw.replace(/\{([^}]+)\}/g, (_match, name) => {
    const servers = Array.isArray(document.servers) ? document.servers : []
    const variable = object(object(servers[0] ?? {}).variables ?? {})[name]
    return typeof object(variable).default === 'string' ? object(variable).default as string : ''
  })
  const parsed = new URL(expanded)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('OpenAPI server URL must be HTTP(S) without embedded credentials')
  return parsed.toString().replace(/\/$/, '')
}

export function discoverOpenApiDocument(config: OpenApiConfig): OpenApiOperation[] {
  const document = parseDocument(config.document)
  const provider = normalizeProviderName(config.providerName)
  const operations: OpenApiOperation[] = []
  for (const [path, rawPathItem] of Object.entries(object(document.paths))) {
    const pathItem = resolveRef(document, rawPathItem)
    for (const [rawMethod, rawOperation] of Object.entries(pathItem)) {
      const method = rawMethod.toLowerCase()
      if (!['get', 'put', 'post', 'delete', 'patch', 'head', 'options'].includes(method) || !rawOperation || typeof rawOperation !== 'object') continue
      const operation = resolveRef(document, rawOperation)
      const subtool = operationName(method, path, operation)
      operations.push({ toolId: qualifiedToolId(provider, subtool), subtool, method, path, description: typeof operation.summary === 'string' ? operation.summary : typeof operation.description === 'string' ? operation.description : `${method.toUpperCase()} ${path}`, inputSchema: inputSchema(document, pathItem, operation), security: operation.security ?? document.security ?? [] })
    }
  }
  if (!operations.length) throw new Error('OpenAPI document has no supported operations')
  if (new Set(operations.map(operation => operation.toolId)).size !== operations.length) throw new Error('OpenAPI document contains duplicate operation IDs')
  return operations
}

async function getServer(db: Database, id: string) {
  const direct = await getEnabledIntegrationForTool(db, 'openapi', id)
  if (direct) return direct
  return (await listEnabledIntegrationsByType(db, 'openapi')).find(server => server.name === id) ?? null
}

export async function discoverOpenApiTools(db: Database, serverId: string): Promise<OpenApiOperation[]> {
  const integration = await getServer(db, serverId)
  if (!integration) throw new Error('OpenAPI server is not enabled or does not exist')
  const config = integration.config as OpenApiConfig
  const operations = discoverOpenApiDocument(config)
  const active = new Set(operations.map(operation => operation.toolId))
  const registered = await db.collection('tool_registry').getFullList({ filter: `namespace = "openapi" && target = "${integration.id.replaceAll('"', '\\"')}"` })
  for (const tool of registered) if (!active.has(String((tool as unknown as { tool_id: string }).tool_id))) await db.collection('tool_registry').update(String(tool.id), { enabled: false, updated_at: Date.now() })
  for (const operation of operations) {
    const operationRisk = risk(operation.method)
    await upsertTool(db, { tool_id: operation.toolId, namespace: 'openapi', description: operation.description, adapter: 'openapi', target: integration.id, operation: operation.subtool, input_schema: operation.inputSchema, output_schema: {}, risk: operationRisk, requires_approval: operationRisk !== 'read', enabled: true, metadata: { providerName: config.providerName, serverId: integration.id, method: operation.method, path: operation.path, security: operation.security } })
  }
  return operations
}

export async function discoverConfiguredOpenApiTools(db: Database, missingOnly = false): Promise<void> {
  for (const integration of await listEnabledIntegrationsByType(db, 'openapi')) {
    if (missingOnly) {
      const existing = await db.collection('tool_registry').getFullList({ filter: `namespace = "openapi" && target = "${integration.id.replaceAll('"', '\\"')}" && enabled = true` })
      if (existing.length) continue
    }
    try {
      const tools = await discoverOpenApiTools(db, integration.id)
      await updateIntegration(db, integration.id, { metadata: { ...integration.metadata, toolCount: tools.length, error: '' } })
    } catch (error) {
      await updateIntegration(db, integration.id, { metadata: { ...integration.metadata, error: error instanceof Error ? error.message : 'OpenAPI discovery failed' } })
    }
  }
}

function headers(config: OpenApiConfig, secrets: OpenApiSecrets, input: JsonObject): Headers {
  const result = new Headers({ accept: 'application/json', ...secrets.headers, ...(input.header && typeof input.header === 'object' ? input.header as Record<string, string> : {}) })
  if (config.authType === 'bearer' && secrets.authValue) result.set('authorization', `Bearer ${secrets.authValue}`)
  if (config.authType === 'basic' && secrets.authUsername !== undefined && secrets.authPassword !== undefined) result.set('authorization', `Basic ${Buffer.from(`${secrets.authUsername}:${secrets.authPassword}`).toString('base64')}`)
  if (config.authType === 'apiKey' && config.authPlacement === 'header' && config.authKeyName && secrets.authValue) result.set(config.authKeyName, secrets.authValue)
  if (config.authType === 'apiKey' && config.authPlacement === 'cookie' && config.authKeyName && secrets.authValue) result.set('cookie', `${config.authKeyName}=${encodeURIComponent(secrets.authValue)}`)
  return result
}

export async function callOpenApiTool(db: Database, serverId: string, subtool: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  const integration = await getServer(db, serverId)
  if (!integration) throw Object.assign(new Error('OpenAPI server is not enabled or does not exist'), { code: 'INTEGRATION_NOT_CONFIGURED' })
  const config = integration.config as OpenApiConfig
  const operation = discoverOpenApiDocument(config).find(value => value.subtool === subtool)
  if (!operation) throw new Error('OpenAPI operation is no longer available')
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input as JsonObject : {}
  const url = new URL(`${serverUrl(parseDocument(config.document), {}, config)}${operation.path.replace(/\{([^}]+)\}/g, (_match, name) => encodeURIComponent(String(object(values.path ?? {})[name] ?? '')))}`)
  for (const [key, value] of Object.entries(object(values.query ?? {}))) url.searchParams.set(key, String(value))
  const secrets = await loadSecrets(db, integration.id)
  if (config.authType === 'apiKey' && config.authPlacement === 'query' && config.authKeyName && secrets.authValue) url.searchParams.set(config.authKeyName, secrets.authValue)
  const requestHeaders = headers(config, secrets, values)
  const body = values.body === undefined ? undefined : JSON.stringify(values.body)
  if (body) requestHeaders.set('content-type', 'application/json')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(config.timeout ?? 15000, 120000)))
  signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const response = await fetch(url, { method: operation.method.toUpperCase(), headers: requestHeaders, body, signal: controller.signal, redirect: 'error' })
    const text = await response.text()
    const result = text.length > 1_000_000 ? `${text.slice(0, 1_000_000)}…` : text
    if (!response.ok) throw Object.assign(new Error(`OpenAPI server returned HTTP ${response.status}: ${result.slice(0, 500)}`), { code: 'OPENAPI_HTTP_ERROR' })
    try { return JSON.parse(result) } catch { return { status: response.status, body: result } }
  } finally { clearTimeout(timer) }
}
