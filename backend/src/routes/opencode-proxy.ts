import { Hono } from 'hono'
import type { Database } from '../db/schema'
import { ENV } from '@subpolar/shared/config/env'
import { createInternalTokenMiddleware } from '../auth/internal-token-middleware'
import type { SettingsService } from '../services/settings'
import { deleteSessionRecord, upsertSessionRecord } from '../db/sessions'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'host',
  'authorization',
])

type JsonResponse = {
  ok: boolean
  json: () => Promise<unknown>
}

export function createOpenCodeProxyRoutes(db: Database, settingsService: SettingsService) {
  const app = new Hono()

  app.use('/*', createInternalTokenMiddleware(db))

  app.all('/*', async (c) => {
    const connectionHeader = c.req.header('connection')?.toLowerCase() ?? ''
    const upgradeHeader = c.req.header('upgrade')?.toLowerCase() ?? ''
    if (connectionHeader.includes('upgrade') && upgradeHeader === 'websocket') {
      return c.json({ error: 'WebSocket proxying is not supported' }, 501)
    }

    const url = new URL(c.req.url)
    const pathSuffix = url.pathname.replace(/^\/api\/opencode-proxy/, '') || '/'
    const upstreamUrl = `http://127.0.0.1:${ENV.OPENCODE.PORT}${pathSuffix}${url.search}`

    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (!HOP_BY_HOP_HEADERS.has(lowerKey)) {
        headers[key] = value
      }
    })

    const password = await settingsService.getOpenCodeServerPassword()
    const username = ENV.OPENCODE.SERVER_USERNAME
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

    let requestBody: RequestInit['body'] = undefined
    let requestBodyText: string | undefined
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      requestBodyText = await c.req.text()
      requestBody = requestBodyText
    }

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: c.req.method,
        headers,
        body: requestBody,
        redirect: 'manual',
        duplex: 'half',
      })

      const responseHeaders: Record<string, string> = {}
      upstreamResponse.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase()
        if (!HOP_BY_HOP_HEADERS.has(lowerKey)) {
          responseHeaders[key] = value
        }
      })

      await persistSessionRequest(db, c.req.method, pathSuffix, url.searchParams.get('directory'), requestBodyText, upstreamResponse.clone())

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    } catch {
      return c.json({ error: 'Proxy request failed' }, 502)
    }
  })

  return app
}

async function persistSessionRequest(
  db: Database,
  method: string,
  path: string,
  directory: string | null,
  requestBodyText: string | undefined,
  response: JsonResponse,
): Promise<void> {
  if (!response.ok) return

  try {
    if (method === 'POST' && path === '/session') {
      const session = await response.json() as { id?: string; title?: string }
      if (!session.id) return
      await upsertSessionRecord(db, {
        sessionId: session.id,
        directory,
        title: session.title ?? getRequestTitle(requestBodyText),
      })
      return
    }

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (!sessionMatch) return

    const rawSessionId = sessionMatch[1]
    if (!rawSessionId) return

    const sessionId = decodeURIComponent(rawSessionId)
    if (method === 'PATCH') {
      await upsertSessionRecord(db, {
        sessionId,
        directory,
        title: getRequestTitle(requestBodyText),
      })
      return
    }

    if (method === 'DELETE') {
      await deleteSessionRecord(db, sessionId)
    }
  } catch {
    return
  }
}

function getRequestTitle(requestBodyText: string | undefined): string | null {
  if (!requestBodyText) return null

  try {
    const body = JSON.parse(requestBodyText) as { title?: unknown }
    return typeof body.title === 'string' ? body.title : null
  } catch {
    return null
  }
}
