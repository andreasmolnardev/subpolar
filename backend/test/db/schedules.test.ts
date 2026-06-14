import { describe, expect, it, vi } from 'vitest'
import * as automationsDb from '../../src/db/automations'
import type PocketBase from 'pocketbase'

function createMockPocketBase(): PocketBase {
  const cols: Record<string, Map<string, Record<string, unknown>>> = {}
  return {
    collection: (name: string) => {
      if (!cols[name]) cols[name] = new Map()
      const col = cols[name]
      return {
        getOne: vi.fn(async <T = unknown>(id: string): Promise<T> => col.get(id) as unknown as T),
        getFirstListItem: vi.fn(async <T = unknown>(): Promise<T> => { throw new Error('Not found') }),
        getFullList: vi.fn(async <T = unknown>(): Promise<T[]> => Array.from(col.values()) as unknown as T[]),
        getList: vi.fn(async <T = unknown>(): Promise<{ items: T[]; totalItems: number }> => {
          const items = Array.from(col.values())
          return { items: items as unknown as T[], totalItems: items.length }
        }),
        create: vi.fn(async <T = unknown>(data: Record<string, unknown>): Promise<T> => {
          const id = (data?.id as string) || String(col.size + 1)
          const record = { ...data, id }
          col.set(id, record)
          return record as unknown as T
        }),
        update: vi.fn(async <T = unknown>(id: string, data: Record<string, unknown>): Promise<T> => {
          const existing = col.get(id)
          if (!existing) throw new Error('Not found')
          const updated = { ...existing, ...data }
          col.set(id, updated)
          return updated as unknown as T
        }),
        delete: vi.fn(async (id: string): Promise<boolean> => col.delete(id)),
      }
    },
    health: { check: vi.fn(async () => ({ code: 200 })) },
  } as unknown as PocketBase
}

function makeJobRecord(overrides: Record<string, unknown> = {}) {
  return {
    repo_id: '42',
    name: 'Weekly engineering summary',
    description: 'Summarize repo health and recent changes.',
    enabled: true,
    automation_mode: 'cron',
    interval_minutes: null,
    cron_expression: '0 9 * * 1',
    timezone: 'UTC',
    agent_slug: 'planner',
    prompt: 'Generate a weekly summary.',
    model: 'openai/gpt-5-mini',
    skill_metadata: JSON.stringify({ skillSlugs: ['planning'], notes: 'Optional notes' }),
    created_at: Date.UTC(2026, 2, 8, 12, 0, 0),
    updated_at: Date.UTC(2026, 2, 9, 12, 0, 0),
    last_run_at: Date.UTC(2026, 2, 9, 11, 0, 0),
    next_run_at: Date.UTC(2026, 2, 9, 13, 0, 0),
    ...overrides,
  }
}

function makeRunRecord(overrides: Record<string, unknown> = {}) {
  return {
    job_id: '7',
    repo_id: '42',
    trigger_source: 'manual',
    status: 'running',
    started_at: Date.UTC(2026, 2, 9, 12, 0, 0),
    finished_at: null,
    created_at: Date.UTC(2026, 2, 9, 12, 0, 0),
    session_id: 'ses-1',
    session_title: 'automationd: Weekly engineering summary',
    log_text: 'Run started. Waiting for assistant response...',
    response_text: null,
    error_text: null,
    ...overrides,
  }
}

describe('automation database queries', () => {
  it('lists automation jobs and parses persisted metadata', async () => {
    const pb = createMockPocketBase()
    const getFullListMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    getFullListMock.mockResolvedValue([{ id: '7', ...makeJobRecord() }])

    const jobs = await automationsDb.listAutomationJobsByRepo(pb, 42)

    expect(getFullListMock).toHaveBeenCalledWith({
      filter: 'repo_id = "42"',
      sort: '-created_at',
    })
    expect(jobs[0]).toMatchObject({
      id: 7,
      repoId: 42,
      automationMode: 'cron',
      skillMetadata: {
        skillSlugs: ['planning'],
        notes: 'Optional notes',
      },
    })
  })

  it('lists automation job ids without loading full job rows', async () => {
    const pb = createMockPocketBase()
    const getFullListMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    getFullListMock.mockResolvedValue([{ id: '7' }, { id: '8' }])

    const jobIds = await automationsDb.listAutomationJobIdsByRepo(pb, 42)

    expect(jobIds).toEqual([7, 8])
  })

  it('creates a automation job and reloads the inserted row', async () => {
    const pb = createMockPocketBase()
    const createMock = pb.collection('automation_jobs').create as ReturnType<typeof vi.fn>
    createMock.mockResolvedValue({ id: '7', ...makeJobRecord() })

    const job = await automationsDb.createAutomationJob(pb, 42, {
      name: 'Weekly engineering summary',
      description: 'Summarize repo health and recent changes.',
      enabled: true,
      automationMode: 'cron',
      intervalMinutes: null,
      cronExpression: '0 9 * * 1',
      timezone: 'UTC',
      agentSlug: 'planner',
      prompt: 'Generate a weekly summary.',
      model: 'openai/gpt-5-mini',
      skillMetadata: { skillSlugs: ['planning'], notes: 'Optional notes' },
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
    })

    expect(createMock).toHaveBeenCalledWith({
      repo_id: '42',
      name: 'Weekly engineering summary',
      description: 'Summarize repo health and recent changes.',
      enabled: true,
      automation_mode: 'cron',
      interval_minutes: null,
      cron_expression: '0 9 * * 1',
      timezone: 'UTC',
      agent_slug: 'planner',
      prompt: 'Generate a weekly summary.',
      model: 'openai/gpt-5-mini',
      skill_metadata: JSON.stringify({ skillSlugs: ['planning'], notes: 'Optional notes' }),
      created_at: expect.any(Number),
      updated_at: expect.any(Number),
      last_run_at: null,
      next_run_at: Date.UTC(2026, 2, 9, 13, 0, 0),
    })
    expect(job.id).toBe(7)
  })

  it('updates a automation job when it exists', async () => {
    const pb = createMockPocketBase()
    const getOneMock = pb.collection('automation_jobs').getOne as ReturnType<typeof vi.fn>
    const updateMock = pb.collection('automation_jobs').update as ReturnType<typeof vi.fn>

    getOneMock.mockResolvedValueOnce({ id: '7', ...makeJobRecord({ name: 'Existing summary' }) })
    updateMock.mockResolvedValueOnce({ id: '7', ...makeJobRecord({ name: 'Updated summary', enabled: false, skill_metadata: null }) })

    const job = await automationsDb.updateAutomationJob(pb, 42, 7, {
      name: 'Updated summary',
      description: null,
      enabled: false,
      automationMode: 'interval',
      intervalMinutes: 90,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Run a new summary.',
      model: null,
      skillMetadata: null,
      nextRunAt: null,
    })

    expect(updateMock).toHaveBeenCalledWith('7', {
      name: 'Updated summary',
      description: null,
      enabled: false,
      automation_mode: 'interval',
      interval_minutes: 90,
      cron_expression: null,
      timezone: null,
      agent_slug: null,
      prompt: 'Run a new summary.',
      model: null,
      skill_metadata: null,
      updated_at: expect.any(Number),
      next_run_at: null,
    })
    expect(job).toMatchObject({
      name: 'Updated summary',
      enabled: false,
      skillMetadata: null,
    })
  })

  it('deletes automation runs before deleting a automation job', async () => {
    const pb = createMockPocketBase()
    const getFullListMock = pb.collection('automation_runs').getFullList as ReturnType<typeof vi.fn>
    const deleteRunsMock = pb.collection('automation_runs').delete as ReturnType<typeof vi.fn>
    const deleteJobMock = pb.collection('automation_jobs').delete as ReturnType<typeof vi.fn>

    getFullListMock.mockResolvedValue([{ id: 'run1' }, { id: 'run2' }])
    deleteJobMock.mockResolvedValue(true)

    const deleted = await automationsDb.deleteAutomationJob(pb, 42, 7)

    expect(getFullListMock).toHaveBeenCalledWith({
      filter: 'repo_id = "42" && job_id = "7"',
    })
    expect(deleteRunsMock).toHaveBeenCalledWith('run1')
    expect(deleteRunsMock).toHaveBeenCalledWith('run2')
    expect(deleteJobMock).toHaveBeenCalledWith('7')
    expect(deleted).toBe(true)
  })

  it('returns null when updating metadata for a missing run', async () => {
    const pb = createMockPocketBase()
    const getOneMock = pb.collection('automation_runs').getOne as ReturnType<typeof vi.fn>
    getOneMock.mockRejectedValue(new Error('Not found'))

    const run = await automationsDb.updateAutomationRunMetadata(pb, 42, 7, 5, {
      sessionTitle: 'Updated title',
    })

    expect(run).toBeNull()
  })

  it('updates automation run metadata while preserving omitted fields', async () => {
    const pb = createMockPocketBase()
    const getOneMock = pb.collection('automation_runs').getOne as ReturnType<typeof vi.fn>
    const updateMock = pb.collection('automation_runs').update as ReturnType<typeof vi.fn>

    const existingRun = makeRunRecord({ response_text: 'Existing response', error_text: 'Existing error' })
    getOneMock.mockResolvedValueOnce({ id: '5', ...existingRun })
    updateMock.mockResolvedValueOnce({ id: '5', ...makeRunRecord({ session_title: 'Updated title', response_text: 'Existing response', error_text: 'Existing error' }) })

    const run = await automationsDb.updateAutomationRunMetadata(pb, 42, 7, 5, {
      sessionTitle: 'Updated title',
    })

    expect(updateMock).toHaveBeenCalledWith('5', {
      session_id: 'ses-1',
      session_title: 'Updated title',
      log_text: 'Run started. Waiting for assistant response...',
      response_text: 'Existing response',
      error_text: 'Existing error',
    })
    expect(run?.sessionTitle).toBe('Updated title')
  })

  it('creates and reloads a automation run', async () => {
    const pb = createMockPocketBase()
    const createMock = pb.collection('automation_runs').create as ReturnType<typeof vi.fn>
    createMock.mockResolvedValue({ id: '5', ...makeRunRecord() })

    const run = await automationsDb.createAutomationRun(pb, {
      jobId: 7,
      repoId: 42,
      triggerSource: 'manual',
      status: 'running',
      startedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
      createdAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    })

    expect(createMock).toHaveBeenCalledWith({
      job_id: '7',
      repo_id: '42',
      trigger_source: 'manual',
      status: 'running',
      started_at: expect.any(Number),
      created_at: expect.any(Number),
    })
    expect(run.id).toBe(5)
  })

  it('lists active runs and maps persisted fields', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    getListMock.mockResolvedValue({
      items: [
        { id: '5', ...makeRunRecord({ id: '5' }) },
        { id: '6', ...makeRunRecord({ id: '6', status: 'failed', error_text: 'Model unavailable' }) },
      ],
      totalItems: 2,
    })

    const runs = await automationsDb.listRunningAutomationRuns(pb, 10)

    expect(getListMock).toHaveBeenCalledWith(1, 10, {
      filter: 'status = "running"',
      sort: 'started_at',
    })
    expect(runs).toHaveLength(2)
    expect(runs[1]).toMatchObject({ id: 6, status: 'failed', errorText: 'Model unavailable' })
  })

  it('lists run summaries without loading large log or response blobs', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    getListMock.mockResolvedValue({
      items: [
        { id: '5', ...makeRunRecord({ log_text: null, response_text: null, error_text: 'Run failed' }) },
      ],
      totalItems: 1,
    })

    const runs = await automationsDb.listAutomationRunsByJob(pb, 42, 7, 5)

    expect(getListMock).toHaveBeenCalledWith(1, 5, {
      filter: 'repo_id = "42" && job_id = "7"',
      sort: '-started_at',
      fields: 'id,job_id,repo_id,trigger_source,status,started_at,finished_at,created_at,session_id,session_title,error_text',
    })
    expect(runs[0]).toMatchObject({
      id: 5,
      logText: null,
      responseText: null,
      errorText: 'Run failed',
    })
  })

  it('returns the running run for a job when present', async () => {
    const pb = createMockPocketBase()
    const getFirstListItemMock = pb.collection('automation_runs').getFirstListItem as ReturnType<typeof vi.fn>
    getFirstListItemMock.mockResolvedValue({ id: '8', ...makeRunRecord({ id: '8' }) })

    const run = await automationsDb.getRunningAutomationRunByJob(pb, 42, 7)

    expect(run).toMatchObject({ id: 8, sessionId: 'ses-1' })
  })

  it('lists enabled automation jobs ordered by id', async () => {
    const pb = createMockPocketBase()
    const getFullListMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    getFullListMock.mockResolvedValue([{ id: '7', ...makeJobRecord() }])

    const jobs = await automationsDb.listEnabledAutomationJobs(pb)

    expect(getFullListMock).toHaveBeenCalledWith({
      filter: 'enabled = true',
      sort: 'id',
    })
    expect(jobs).toHaveLength(1)
    expect(jobs.at(0)?.enabled).toBe(true)
  })

  it('gets a automation job by id when found', async () => {
    const pb = createMockPocketBase()
    const getOneMock = pb.collection('automation_jobs').getOne as ReturnType<typeof vi.fn>
    getOneMock.mockResolvedValue({ id: '7', ...makeJobRecord() })

    const job = await automationsDb.getAutomationJobById(pb, 42, 7)

    expect(getOneMock).toHaveBeenCalledWith('7')
    expect(job).toMatchObject({ id: 7, repoId: 42, name: 'Weekly engineering summary' })
  })

  it('returns null when automation job is not found', async () => {
    const pb = createMockPocketBase()
    const getOneMock = pb.collection('automation_jobs').getOne as ReturnType<typeof vi.fn>
    getOneMock.mockRejectedValue(new Error('Not found'))

    const job = await automationsDb.getAutomationJobById(pb, 42, 7)
    expect(job).toBeNull()
  })

  it('deletes a automation job successfully', async () => {
    const pb = createMockPocketBase()
    const getFullListMock = pb.collection('automation_runs').getFullList as ReturnType<typeof vi.fn>
    const deleteMock = pb.collection('automation_jobs').delete as ReturnType<typeof vi.fn>

    getFullListMock.mockResolvedValue([])
    deleteMock.mockResolvedValue(true)

    const result = await automationsDb.deleteAutomationJob(pb, 42, 7)

    expect(deleteMock).toHaveBeenCalledWith('7')
    expect(result).toBe(true)
  })

  it('returns false when deleting a non-existent automation job', async () => {
    const pb = createMockPocketBase()
    const getFullListMock = pb.collection('automation_runs').getFullList as ReturnType<typeof vi.fn>
    const deleteMock = pb.collection('automation_jobs').delete as ReturnType<typeof vi.fn>

    getFullListMock.mockResolvedValue([])
    deleteMock.mockRejectedValue(new Error('Not found'))

    const result = await automationsDb.deleteAutomationJob(pb, 42, 7)
    expect(result).toBe(false)
  })

  it('updates the run state of a automation job', async () => {
    const pb = createMockPocketBase()
    const updateMock = pb.collection('automation_jobs').update as ReturnType<typeof vi.fn>
    updateMock.mockResolvedValue({})

    const lastRunAt = Date.now()
    const nextRunAt = Date.now() + 3600000

    await automationsDb.updateAutomationJobRunState(pb, 42, 7, { lastRunAt, nextRunAt })

    expect(updateMock).toHaveBeenCalledWith('7', {
      last_run_at: lastRunAt,
      next_run_at: nextRunAt,
      updated_at: expect.any(Number),
    })
  })

  it('updates a automation run and reloads the result', async () => {
    const pb = createMockPocketBase()
    const updateMock = pb.collection('automation_runs').update as ReturnType<typeof vi.fn>
    updateMock.mockResolvedValue({ id: '5', ...makeRunRecord({ status: 'completed', response_text: 'Completed' }) })

    const run = await automationsDb.updateAutomationRun(pb, 42, 7, 5, {
      status: 'completed',
      finishedAt: Date.now(),
      sessionId: 'ses-1',
      sessionTitle: 'Updated title',
      logText: 'Log output',
      responseText: 'Completed',
      errorText: null,
    })

    expect(updateMock).toHaveBeenCalledWith('5', {
      status: 'completed',
      finished_at: expect.any(Number),
      session_id: 'ses-1',
      session_title: 'Updated title',
      log_text: 'Log output',
      response_text: 'Completed',
      error_text: null,
    })
    expect(run).toMatchObject({ status: 'completed', responseText: 'Completed' })
  })

  it('gets a automation run by id when found', async () => {
    const pb = createMockPocketBase()
    const getOneMock = pb.collection('automation_runs').getOne as ReturnType<typeof vi.fn>
    getOneMock.mockResolvedValue({ id: '5', ...makeRunRecord() })

    const run = await automationsDb.getAutomationRunById(pb, 42, 7, 5)

    expect(getOneMock).toHaveBeenCalledWith('5')
    expect(run).toMatchObject({ id: 5, jobId: 7, repoId: 42, status: 'running' })
  })

  it('returns null when automation run is not found', async () => {
    const pb = createMockPocketBase()
    const getOneMock = pb.collection('automation_runs').getOne as ReturnType<typeof vi.fn>
    getOneMock.mockRejectedValue(new Error('Not found'))

    const run = await automationsDb.getAutomationRunById(pb, 42, 7, 5)
    expect(run).toBeNull()
  })

  it('lists all runs with context and no filters', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    const getFullListJobsMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    const getFullListReposMock = pb.collection('repos').getFullList as ReturnType<typeof vi.fn>

    getListMock.mockResolvedValue({
      items: [{ id: '5', ...makeRunRecord(), job_name: 'Weekly summary', repo_path: '/home/user/my-repo' }],
      totalItems: 1,
    })
    getFullListJobsMock.mockResolvedValue([{ id: '7', name: 'Weekly summary' }])
    getFullListReposMock.mockResolvedValue([{ id: '42', repo_url: '', local_path: '/home/user/my-repo' }])

    const result = await automationsDb.listAllAutomationRuns(pb, {})

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 5,
      jobName: 'Weekly summary',
      repoName: 'my-repo',
      repoPath: '/home/user/my-repo',
    })
  })

  it('applies status filter', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    const getFullListJobsMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    const getFullListReposMock = pb.collection('repos').getFullList as ReturnType<typeof vi.fn>

    getListMock.mockResolvedValue({ items: [], totalItems: 0 })
    getFullListJobsMock.mockResolvedValue([])
    getFullListReposMock.mockResolvedValue([])

    await automationsDb.listAllAutomationRuns(pb, { status: 'completed' })

    expect(getListMock).toHaveBeenCalledWith(1, 50, {
      filter: 'status = "completed"',
      sort: '-started_at',
      skip: 0,
      expand: 'job_id,repo_id',
    })
  })

  it('applies repoId filter', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    const getFullListJobsMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    const getFullListReposMock = pb.collection('repos').getFullList as ReturnType<typeof vi.fn>

    getListMock.mockResolvedValue({ items: [], totalItems: 0 })
    getFullListJobsMock.mockResolvedValue([])
    getFullListReposMock.mockResolvedValue([])

    await automationsDb.listAllAutomationRuns(pb, { repoId: 42 })

    expect(getListMock).toHaveBeenCalledWith(1, 50, {
      filter: 'repo_id = "42"',
      sort: '-started_at',
      skip: 0,
      expand: 'job_id,repo_id',
    })
  })

  it('applies jobId filter', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    const getFullListJobsMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    const getFullListReposMock = pb.collection('repos').getFullList as ReturnType<typeof vi.fn>

    getListMock.mockResolvedValue({ items: [], totalItems: 0 })
    getFullListJobsMock.mockResolvedValue([])
    getFullListReposMock.mockResolvedValue([])

    await automationsDb.listAllAutomationRuns(pb, { jobId: 7 })

    expect(getListMock).toHaveBeenCalledWith(1, 50, {
      filter: 'job_id = "7"',
      sort: '-started_at',
      skip: 0,
      expand: 'job_id,repo_id',
    })
  })

  it('applies triggerSource filter', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    const getFullListJobsMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    const getFullListReposMock = pb.collection('repos').getFullList as ReturnType<typeof vi.fn>

    getListMock.mockResolvedValue({ items: [], totalItems: 0 })
    getFullListJobsMock.mockResolvedValue([])
    getFullListReposMock.mockResolvedValue([])

    await automationsDb.listAllAutomationRuns(pb, { triggerSource: 'manual' })

    expect(getListMock).toHaveBeenCalledWith(1, 50, {
      filter: 'trigger_source = "manual"',
      sort: '-started_at',
      skip: 0,
      expand: 'job_id,repo_id',
    })
  })

  it('applies limit and offset', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    const getFullListJobsMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    const getFullListReposMock = pb.collection('repos').getFullList as ReturnType<typeof vi.fn>

    getListMock.mockResolvedValue({ items: [], totalItems: 0 })
    getFullListJobsMock.mockResolvedValue([])
    getFullListReposMock.mockResolvedValue([])

    await automationsDb.listAllAutomationRuns(pb, { limit: 10, offset: 20 })

    expect(getListMock).toHaveBeenCalledWith(1, 10, {
      filter: '',
      sort: '-started_at',
      skip: 20,
      expand: 'job_id,repo_id',
    })
  })

  it('returns NULL for log_text and response_text', async () => {
    const pb = createMockPocketBase()
    const getListMock = pb.collection('automation_runs').getList as ReturnType<typeof vi.fn>
    const getFullListJobsMock = pb.collection('automation_jobs').getFullList as ReturnType<typeof vi.fn>
    const getFullListReposMock = pb.collection('repos').getFullList as ReturnType<typeof vi.fn>

    getListMock.mockResolvedValue({
      items: [{ id: '5', ...makeRunRecord({ log_text: 'should be null', response_text: 'should be null' }), job_name: 'Test job', repo_path: '/test' }],
      totalItems: 1,
    })
    getFullListJobsMock.mockResolvedValue([])
    getFullListReposMock.mockResolvedValue([])

    await automationsDb.listAllAutomationRuns(pb, {})

    expect(getListMock).toHaveBeenCalledWith(1, 50, {
      filter: '',
      sort: '-started_at',
      skip: 0,
      expand: 'job_id,repo_id',
    })
  })
})
