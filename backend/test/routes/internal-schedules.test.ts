import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import { AutomationService } from '../../src/services/automations'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'

describe('internal-automations routes', () => {
  let db: Database
  let automationservice: AutomationService
  let notificationService: NotificationService
  let settingsService: SettingsService
  let app: Hono
  let token: string

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    const openCodeClient = createOpenCodeClient()
    automationservice = new AutomationService(db, openCodeClient)
    notificationService = new NotificationService(db)
    settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, automationservice, notificationService, settingsService, openCodeClient))
    token = getOrCreateInternalToken(db)
  })

  it('GET /api/internal/automations/all returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/automations/all')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/automations/all returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/automations/all', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { jobs: unknown[] }
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  it('GET /api/internal/automations/all/runs returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/automations/all/runs', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { runs: unknown[] }
    expect(body).toHaveProperty('runs')
  })

  it('POST /api/internal/repos/:id/automations/:jobId/run returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos/1/automations/1/run', {
      method: 'POST',
    })
    expect(res.status).toBe(401)
  })
})
