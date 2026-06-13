import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { AutomationServiceError } from '../../src/services/automations'

const automationservice = {
  listJobs: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  runJob: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  cancelRun: vi.fn(),
  listAllEnabledJobs: vi.fn(),
  listAllJobsWithRepos: vi.fn(),
  listAllRuns: vi.fn(),
  recoverRunningRuns: vi.fn(),
  setJobChangeHandler: vi.fn(),
}

vi.mock('../../src/services/automations', async () => {
  const actual = await vi.importActual('../../src/services/automations')
  return {
    ...actual,
    AutomationService: vi.fn().mockImplementation(() => automationservice),
  }
})

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createAutomationRoutes } from '../../src/routes/automations'

describe('Automation Routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/repos/:id/automations', createAutomationRoutes(automationservice as unknown as import('../../src/services/automations').AutomationService))
  })

  it('lists jobs for a repo', async () => {
    automationservice.listJobs.mockReturnValue([{ id: 7, name: 'Weekly engineering summary' }])

    const response = await app.request('/repos/42/automations')
    const body = await response.json() as { jobs: Array<{ id: number }> }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(1)
    expect(automationservice.listJobs).toHaveBeenCalledWith(42)
  })

  it('creates a automation from a valid request body', async () => {
    automationservice.createJob.mockReturnValue({ id: 7, name: 'Daily release summary' })

    const response = await app.request('/repos/42/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Daily release summary',
        enabled: true,
        automationMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Summarize release readiness.',
      }),
    })
    const body = await response.json() as { job: { id: number } }

    expect(response.status).toBe(201)
    expect(body.job.id).toBe(7)
    expect(automationservice.createJob).toHaveBeenCalledWith(42, expect.objectContaining({ name: 'Daily release summary' }))
  })

  it('runs a automation manually', async () => {
    automationservice.runJob.mockResolvedValue({ id: 5, status: 'running' })

    const response = await app.request('/repos/42/automations/7/run', {
      method: 'POST',
    })
    const body = await response.json() as { run: { id: number; status: string } }

    expect(response.status).toBe(200)
    expect(body.run).toEqual({ id: 5, status: 'running' })
    expect(automationservice.runJob).toHaveBeenCalledWith(42, 7, 'manual')
  })

  it('cancels a running automation run', async () => {
    automationservice.cancelRun.mockResolvedValue({ id: 5, status: 'cancelled' })

    const response = await app.request('/repos/42/automations/7/runs/5/cancel', {
      method: 'POST',
    })
    const body = await response.json() as { run: { status: string } }

    expect(response.status).toBe(200)
    expect(body.run.status).toBe('cancelled')
    expect(automationservice.cancelRun).toHaveBeenCalledWith(42, 7, 5)
  })

  it('maps service conflicts to HTTP 409 responses', async () => {
    automationservice.runJob.mockRejectedValue(new AutomationServiceError('Automation is already running', 409))

    const response = await app.request('/repos/42/automations/7/run', {
      method: 'POST',
    })
    const body = await response.json() as { error: string }

    expect(response.status).toBe(409)
    expect(body.error).toBe('Automation is already running')
  })

  it('returns 400 for invalid route ids before reaching the service', async () => {
    const response = await app.request('/repos/not-a-number/automations')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid repo id')
    expect(automationservice.listJobs).not.toHaveBeenCalled()
  })

  it('loads and updates a single automation job', async () => {
    automationservice.getJob.mockReturnValue({ id: 7, name: 'Weekly engineering summary' })
    automationservice.updateJob.mockReturnValue({ id: 7, name: 'Updated engineering summary' })

    const getResponse = await app.request('/repos/42/automations/7')
    const getBody = await getResponse.json() as { job: { name: string } }

    const patchResponse = await app.request('/repos/42/automations/7', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated engineering summary' }),
    })
    const patchBody = await patchResponse.json() as { job: { name: string } }

    expect(getResponse.status).toBe(200)
    expect(getBody.job.name).toBe('Weekly engineering summary')
    expect(patchResponse.status).toBe(200)
    expect(patchBody.job.name).toBe('Updated engineering summary')
  })

  it('lists runs, loads a single run, and deletes a automation', async () => {
    automationservice.listRuns.mockReturnValue([{ id: 5, status: 'completed' }])
    automationservice.getRun.mockReturnValue({ id: 5, status: 'completed' })
    automationservice.deleteJob.mockReturnValue(undefined)

    const runsResponse = await app.request('/repos/42/automations/7/runs?limit=5')
    const runsBody = await runsResponse.json() as { runs: Array<{ id: number }> }

    const runResponse = await app.request('/repos/42/automations/7/runs/5')
    const runBody = await runResponse.json() as { run: { id: number } }

    const deleteResponse = await app.request('/repos/42/automations/7', {
      method: 'DELETE',
    })
    const deleteBody = await deleteResponse.json() as { success: boolean }

    expect(runsResponse.status).toBe(200)
    expect(runsBody.runs[0]?.id).toBe(5)
    expect(runResponse.status).toBe(200)
    expect(runBody.run.id).toBe(5)
    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.success).toBe(true)
    expect(automationservice.deleteJob).toHaveBeenCalledWith(42, 7)
  })

  it('rejects non-positive run list limits', async () => {
    const response = await app.request('/repos/42/automations/7/runs?limit=0')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe('Limit must be greater than 0')
    expect(automationservice.listRuns).not.toHaveBeenCalled()
  })

  it('clamps large run list limits', async () => {
    automationservice.listRuns.mockReturnValue([])

    const response = await app.request('/repos/42/automations/7/runs?limit=500')

    expect(response.status).toBe(200)
    expect(automationservice.listRuns).toHaveBeenCalledWith(42, 7, 100)
  })

  it('returns 404 when automation job is not found', async () => {
    automationservice.getJob.mockReturnValue(null)

    const response = await app.request('/repos/42/automations/7')
    const body = await response.json() as { error: string }

    expect(response.status).toBe(404)
    expect(body.error).toBe('Automation not found')
  })

  it('creates a cron automation from a valid request body', async () => {
    automationservice.createJob.mockReturnValue({ id: 8, name: 'Morning report' })

    const response = await app.request('/repos/42/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Morning report',
        enabled: true,
        automationMode: 'cron',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        prompt: 'Generate the daily report.',
      }),
    })
    const body = await response.json() as { job: { id: number } }

    expect(response.status).toBe(201)
    expect(body.job.id).toBe(8)
    expect(automationservice.createJob).toHaveBeenCalledWith(42, expect.objectContaining({
      automationMode: 'cron',
      cronExpression: '0 9 * * *',
      timezone: 'America/New_York',
    }))
  })

  it('lists all automations across all repos', async () => {
    automationservice.listAllJobsWithRepos.mockReturnValue([
      { id: 1, name: 'Job 1', repoName: 'Repo A', repoPath: '/path/a', repoUrl: 'https://repo-a' },
      { id: 2, name: 'Job 2', repoName: 'Repo B', repoPath: '/path/b', repoUrl: 'https://repo-b' },
    ])

    const response = await app.request('/repos/42/automations/all')
    const body = await response.json() as { jobs: Array<{ id: number; name: string; repoName: string }> }

    expect(response.status).toBe(200)
    expect(body.jobs).toHaveLength(2)
    expect(body.jobs[0]).toEqual(expect.objectContaining({
      id: 1,
      name: 'Job 1',
      repoName: 'Repo A',
    }))
    expect(automationservice.listAllJobsWithRepos).toHaveBeenCalled()
  })

  it('lists all runs with no filters', async () => {
    automationservice.listAllRuns.mockReturnValue([
      { id: 1, jobId: 7, repoId: 42, status: 'completed', jobName: 'Test', repoName: 'repo', repoPath: '/repo' },
    ])

    const response = await app.request('/repos/42/automations/all/runs')
    const body = await response.json() as { runs: Array<{ id: number }> }

    expect(response.status).toBe(200)
    expect(body.runs).toHaveLength(1)
    expect(automationservice.listAllRuns).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }))
  })

  it('passes query params to service for all runs', async () => {
    automationservice.listAllRuns.mockReturnValue([])

    const response = await app.request('/repos/42/automations/all/runs?limit=10&offset=5&status=failed&repoId=42&jobId=7&triggerSource=manual')
    const body = await response.json() as { runs: Array<unknown> }

    expect(response.status).toBe(200)
    expect(body.runs).toHaveLength(0)
    expect(automationservice.listAllRuns).toHaveBeenCalledWith({
      limit: 10,
      offset: 5,
      status: 'failed',
      repoId: 42,
      jobId: 7,
      triggerSource: 'manual',
    })
  })
})
