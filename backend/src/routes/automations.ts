import { Hono } from 'hono'
import {
  CreateAutomationJobRequestSchema,
  UpdateAutomationJobRequestSchema,
} from '@subpolar/shared/schemas'
import { AutomationService, AutomationServiceError } from '../services/automations'
import { parseId, handleServiceError } from '../utils/route-helpers'

function parseRunListLimit(value: string | undefined): number {
  if (value === undefined) {
    return 20
  }

  const parsed = parseId(value, 'limit', AutomationServiceError)
  if (parsed < 1) {
    throw new AutomationServiceError('Limit must be greater than 0', 400)
  }

  return Math.min(parsed, 100)
}

export function createAutomationRoutes(automationService: AutomationService) {
  const app = new Hono()

  app.get('/all', (c) => {
    try {
      const jobs = automationService.listAllJobsWithRepos()
      return c.json({ jobs })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list all automations', AutomationServiceError)
    }
  })

  app.get('/all/runs', (c) => {
    try {
      const limit = parseRunListLimit(c.req.query('limit'))
      const offsetStr = c.req.query('offset')
      const offset = offsetStr ? Math.max(parseInt(offsetStr, 10) || 0, 0) : 0
      const status = c.req.query('status') || undefined
      const repoIdStr = c.req.query('repoId')
      const repoId = repoIdStr ? (() => {
        const parsed = parseInt(repoIdStr, 10)
        return Number.isNaN(parsed) ? undefined : parsed
      })() : undefined
      const jobIdStr = c.req.query('jobId')
      const jobId = jobIdStr ? (() => {
        const parsed = parseInt(jobIdStr, 10)
        return Number.isNaN(parsed) ? undefined : parsed
      })() : undefined
      const triggerSource = c.req.query('triggerSource') || undefined
      const runs = automationService.listAllRuns({ limit, offset, status, repoId, jobId, triggerSource })
      return c.json({ runs })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list all automation runs', AutomationServiceError)
    }
  })

  app.get('/', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      return c.json({ jobs: automationService.listJobs(repoId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list automations', AutomationServiceError)
    }
  })

  app.post('/', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      const body = await c.req.json()
      const input = CreateAutomationJobRequestSchema.parse(body)
      const job = automationService.createJob(repoId, input)
      return c.json({ job }, 201)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to create automation', AutomationServiceError)
    }
  })

  app.get('/:jobId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      const jobId = parseId(c.req.param('jobId'), 'automation id', AutomationServiceError)
      const job = automationService.getJob(repoId, jobId)
      if (!job) {
        return c.json({ error: 'Automation not found' }, 404)
      }
      return c.json({ job })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get automation', AutomationServiceError)
    }
  })

  app.patch('/:jobId', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      const jobId = parseId(c.req.param('jobId'), 'automation id', AutomationServiceError)
      const body = await c.req.json()
      const input = UpdateAutomationJobRequestSchema.parse(body)
      const job = automationService.updateJob(repoId, jobId, input)
      return c.json({ job })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to update automation', AutomationServiceError)
    }
  })

  app.delete('/:jobId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      const jobId = parseId(c.req.param('jobId'), 'automation id', AutomationServiceError)
      automationService.deleteJob(repoId, jobId)
      return c.json({ success: true })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to delete automation', AutomationServiceError)
    }
  })

  app.post('/:jobId/run', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      const jobId = parseId(c.req.param('jobId'), 'automation id', AutomationServiceError)
      const run = await automationService.runJob(repoId, jobId, 'manual')
      return c.json({ run })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to run automation', AutomationServiceError)
    }
  })

  app.get('/:jobId/runs', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      const jobId = parseId(c.req.param('jobId'), 'automation id', AutomationServiceError)
      const limit = parseRunListLimit(c.req.query('limit'))
      return c.json({ runs: automationService.listRuns(repoId, jobId, limit) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to list automation runs', AutomationServiceError)
    }
  })

  app.get('/:jobId/runs/:runId', (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      const jobId = parseId(c.req.param('jobId'), 'automation id', AutomationServiceError)
      const runId = parseId(c.req.param('runId'), 'run id', AutomationServiceError)
      return c.json({ run: automationService.getRun(repoId, jobId, runId) })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get automation run', AutomationServiceError)
    }
  })

  app.post('/:jobId/runs/:runId/cancel', async (c) => {
    try {
      const repoId = parseId(c.req.param('id'), 'repo id', AutomationServiceError)
      const jobId = parseId(c.req.param('jobId'), 'automation id', AutomationServiceError)
      const runId = parseId(c.req.param('runId'), 'run id', AutomationServiceError)
      const run = await automationService.cancelRun(repoId, jobId, runId)
      return c.json({ run })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to cancel automation run', AutomationServiceError)
    }
  })

  return app
}
