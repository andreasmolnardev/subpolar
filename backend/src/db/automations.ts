import type PocketBase from 'pocketbase'
import {
  AutomationJobSchema,
  AutomationRunSchema,
  AutomationSkillMetadataSchema,
  type AutomationJob,
  type AutomationMode,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationRunTriggerSource,
} from '@subpolar/shared/schemas'
import { GENERAL_CHAT_PROJECT_ID, GENERAL_CHAT_PROJECT_NAME, GENERAL_CHAT_PROJECT_PATH } from '@subpolar/shared/utils'
import type { AutomationJobPersistenceInput } from '../services/automation-config'

interface AutomationJobRecord {
  id: string
  repo_id: string
  name: string
  description: string | null
  enabled: boolean
  automation_mode: AutomationMode | null
  interval_minutes: number | null
  cron_expression: string | null
  timezone: string | null
  agent_slug: string | null
  prompt: string
  model: string | null
  skill_metadata: string | null
  created_at: number
  updated_at: number
  last_run_at: number | null
  next_run_at: number | null
}

interface AutomationRunRecord {
  id: string
  job_id: string
  repo_id: string
  trigger_source: string
  status: string
  started_at: number
  finished_at: number | null
  created_at: number
  session_id: string | null
  session_title: string | null
  log_text: string | null
  response_text: string | null
  error_text: string | null
}

function parseSkillMetadata(raw: unknown) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const result = AutomationSkillMetadataSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function rowToAutomationJob(row: AutomationJobRecord): AutomationJob {
  return AutomationJobSchema.parse({
    id: parseInt(row.id, 10),
    repoId: parseInt(row.repo_id, 10),
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    automationMode: row.automation_mode ?? 'interval',
    intervalMinutes: row.interval_minutes,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    agentSlug: row.agent_slug,
    prompt: row.prompt,
    model: row.model,
    skillMetadata: parseSkillMetadata(row.skill_metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
  })
}

function rowToAutomationRun(row: AutomationRunRecord): AutomationRun {
  return AutomationRunSchema.parse({
    id: parseInt(row.id, 10),
    jobId: parseInt(row.job_id, 10),
    repoId: parseInt(row.repo_id, 10),
    triggerSource: row.trigger_source,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    logText: row.log_text,
    responseText: row.response_text,
    errorText: row.error_text,
  })
}

function serializeSkillMetadata(skillMetadata: AutomationJobPersistenceInput['skillMetadata']): string | null {
  if (!skillMetadata) return null
  return JSON.stringify(skillMetadata)
}

function toPbId(num: number): string {
  return String(num)
}

export async function listAutomationJobsByRepo(pb: PocketBase, repoId: number): Promise<AutomationJob[]> {
  const result = await pb.collection('automation_jobs').getFullList({
    filter: `repo_id = "${toPbId(repoId)}"`,
    sort: '-created_at',
  })
  return (result as unknown as AutomationJobRecord[]).map(rowToAutomationJob)
}

export async function listAutomationJobIdsByRepo(pb: PocketBase, repoId: number): Promise<number[]> {
  const result = await pb.collection('automation_jobs').getFullList({
    filter: `repo_id = "${toPbId(repoId)}"`,
    sort: '-created_at',
    fields: 'id',
  })
  return (result as unknown as Array<{ id: string }>).map((r) => parseInt(r.id, 10))
}

export async function listEnabledAutomationJobs(pb: PocketBase): Promise<AutomationJob[]> {
  const result = await pb.collection('automation_jobs').getFullList({
    filter: 'enabled = true',
    sort: 'id',
  })
  return (result as unknown as AutomationJobRecord[]).map(rowToAutomationJob)
}

export async function getAutomationJobById(pb: PocketBase, repoId: number, jobId: number): Promise<AutomationJob | null> {
  try {
    const record = await pb.collection('automation_jobs').getOne(toPbId(jobId))
    const r = record as unknown as AutomationJobRecord
    if (parseInt(r.repo_id, 10) !== repoId) return null
    return rowToAutomationJob(r)
  } catch {
    return null
  }
}

export async function createAutomationJob(pb: PocketBase, repoId: number, input: AutomationJobPersistenceInput): Promise<AutomationJob> {
  const now = Date.now()
  const record = await pb.collection('automation_jobs').create({
    repo_id: toPbId(repoId),
    name: input.name,
    description: input.description ?? null,
    enabled: input.enabled,
    automation_mode: input.automationMode,
    interval_minutes: input.intervalMinutes,
    cron_expression: input.cronExpression,
    timezone: input.timezone,
    agent_slug: input.agentSlug ?? null,
    prompt: input.prompt,
    model: input.model ?? null,
    skill_metadata: serializeSkillMetadata(input.skillMetadata),
    created_at: now,
    updated_at: now,
    last_run_at: null,
    next_run_at: input.nextRunAt,
  })
  const r = record as unknown as AutomationJobRecord
  return rowToAutomationJob(r)
}

export async function updateAutomationJob(pb: PocketBase, repoId: number, jobId: number, input: AutomationJobPersistenceInput): Promise<AutomationJob | null> {
  const existing = await getAutomationJobById(pb, repoId, jobId)
  if (!existing) return null

  const now = Date.now()
  const record = await pb.collection('automation_jobs').update(toPbId(jobId), {
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    automation_mode: input.automationMode,
    interval_minutes: input.intervalMinutes,
    cron_expression: input.cronExpression,
    timezone: input.timezone,
    agent_slug: input.agentSlug,
    prompt: input.prompt,
    model: input.model,
    skill_metadata: serializeSkillMetadata(input.skillMetadata),
    updated_at: now,
    next_run_at: input.nextRunAt,
  })
  const r = record as unknown as AutomationJobRecord
  return rowToAutomationJob(r)
}

export async function deleteAutomationJob(pb: PocketBase, repoId: number, jobId: number): Promise<boolean> {
  const runs = await pb.collection('automation_runs').getFullList({
    filter: `repo_id = "${toPbId(repoId)}" && job_id = "${toPbId(jobId)}"`,
  })
  for (const run of runs) {
    await pb.collection('automation_runs').delete(run.id)
  }
  try {
    await pb.collection('automation_jobs').delete(toPbId(jobId))
    return true
  } catch {
    return false
  }
}

export async function cleanupOrphanedAutomations(pb: PocketBase): Promise<{ orphanedJobs: number; orphanedRuns: number }> {
  const allProjects = await pb.collection('projects').getFullList({ fields: 'id' })
  const projectIds = new Set((allProjects as unknown as Array<{ id: string }>).map(r => r.id))

  const allJobs = await pb.collection('automation_jobs').getFullList({ fields: 'id,repo_id' })
  let orphanedJobs = 0
  for (const j of allJobs as unknown as Array<{ id: string; repo_id: string }>) {
    if (j.repo_id !== toPbId(GENERAL_CHAT_PROJECT_ID) && !projectIds.has(j.repo_id)) {
      await pb.collection('automation_jobs').delete(j.id)
      orphanedJobs++
    }
  }

  const allRuns = await pb.collection('automation_runs').getFullList({ fields: 'id,repo_id,job_id' })
  let orphanedRuns = 0
  const allJobIds = new Set((await pb.collection('automation_jobs').getFullList({ fields: 'id' }) as unknown as Array<{ id: string }>).map(r => r.id))
  for (const r of allRuns as unknown as Array<{ id: string; repo_id: string; job_id: string }>) {
    if ((r.repo_id !== toPbId(GENERAL_CHAT_PROJECT_ID) && !projectIds.has(r.repo_id)) || !allJobIds.has(r.job_id)) {
      await pb.collection('automation_runs').delete(r.id)
      orphanedRuns++
    }
  }

  return { orphanedJobs, orphanedRuns }
}

export async function updateAutomationJobRunState(pb: PocketBase, repoId: number, jobId: number, values: { lastRunAt: number; nextRunAt?: number | null }): Promise<void> {
  await pb.collection('automation_jobs').update(toPbId(jobId), {
    last_run_at: values.lastRunAt,
    next_run_at: values.nextRunAt ?? null,
    updated_at: Date.now(),
  })
}

export async function createAutomationRun(
  pb: PocketBase,
  input: {
    jobId: number
    repoId: number
    triggerSource: AutomationRunTriggerSource
    status: AutomationRunStatus
    startedAt: number
    createdAt: number
  },
): Promise<AutomationRun> {
  const record = await pb.collection('automation_runs').create({
    job_id: toPbId(input.jobId),
    repo_id: toPbId(input.repoId),
    trigger_source: input.triggerSource,
    status: input.status,
    started_at: input.startedAt,
    created_at: input.createdAt,
  })
  return rowToAutomationRun(record as unknown as AutomationRunRecord)
}

export async function updateAutomationRun(
  pb: PocketBase,
  repoId: number,
  jobId: number,
  runId: number,
  input: {
    status: AutomationRunStatus
    finishedAt: number
    sessionId?: string | null
    sessionTitle?: string | null
    logText?: string | null
    responseText?: string | null
    errorText?: string | null
  },
): Promise<AutomationRun | null> {
  try {
    const record = await pb.collection('automation_runs').update(toPbId(runId), {
      status: input.status,
      finished_at: input.finishedAt,
      session_id: input.sessionId ?? null,
      session_title: input.sessionTitle ?? null,
      log_text: input.logText ?? null,
      response_text: input.responseText ?? null,
      error_text: input.errorText ?? null,
    })
    return rowToAutomationRun(record as unknown as AutomationRunRecord)
  } catch {
    return null
  }
}

export async function updateAutomationRunMetadata(
  pb: PocketBase,
  repoId: number,
  jobId: number,
  runId: number,
  input: {
    sessionId?: string | null
    sessionTitle?: string | null
    logText?: string | null
    responseText?: string | null
    errorText?: string | null
  },
): Promise<AutomationRun | null> {
  const existing = await getAutomationRunById(pb, repoId, jobId, runId)
  if (!existing) return null

  try {
    const record = await pb.collection('automation_runs').update(toPbId(runId), {
      session_id: input.sessionId === undefined ? existing.sessionId : input.sessionId,
      session_title: input.sessionTitle === undefined ? existing.sessionTitle : input.sessionTitle,
      log_text: input.logText === undefined ? existing.logText : input.logText,
      response_text: input.responseText === undefined ? existing.responseText : input.responseText,
      error_text: input.errorText === undefined ? existing.errorText : input.errorText,
    })
    return rowToAutomationRun(record as unknown as AutomationRunRecord)
  } catch {
    return null
  }
}

export async function getAutomationRunById(pb: PocketBase, repoId: number, jobId: number, runId: number): Promise<AutomationRun | null> {
  try {
    const record = await pb.collection('automation_runs').getOne(toPbId(runId))
    const r = record as unknown as AutomationRunRecord
    if (parseInt(r.repo_id, 10) !== repoId || parseInt(r.job_id, 10) !== jobId) return null
    return rowToAutomationRun(r)
  } catch {
    return null
  }
}

export async function getRunningAutomationRunByJob(pb: PocketBase, repoId: number, jobId: number): Promise<AutomationRun | null> {
  try {
    const record = await pb.collection('automation_runs').getFirstListItem(
      `repo_id = "${toPbId(repoId)}" && job_id = "${toPbId(jobId)}" && status = "running"`,
    )
    return rowToAutomationRun(record as unknown as AutomationRunRecord)
  } catch {
    return null
  }
}

export async function listRunningAutomationRuns(pb: PocketBase, limit: number = 100): Promise<AutomationRun[]> {
  const result = await pb.collection('automation_runs').getList(1, limit, {
    filter: 'status = "running"',
    sort: 'started_at',
  })
  return (result.items as unknown as AutomationRunRecord[]).map(rowToAutomationRun)
}

export async function listAutomationRunsByJob(pb: PocketBase, repoId: number, jobId: number, limit: number = 20): Promise<AutomationRun[]> {
  const result = await pb.collection('automation_runs').getList(1, limit, {
    filter: `repo_id = "${toPbId(repoId)}" && job_id = "${toPbId(jobId)}"`,
    sort: '-started_at',
    fields: 'id,job_id,repo_id,trigger_source,status,started_at,finished_at,created_at,session_id,session_title,error_text',
  })
  return (result.items as unknown as AutomationRunRecord[]).map((r) => ({
    ...r,
    log_text: null,
    response_text: null,
  })).map(rowToAutomationRun)
}

export interface AutomationJobWithRepo extends AutomationJob {
  repoName: string
  repoPath: string
  repoUrl: string
}

function repoNameFromPath(repoPath: string): string {
  if (!repoPath || repoPath === '/') return 'Unknown'
  return repoPath.split(/[\\/]/).pop() ?? repoPath
}

function resolveRepoDisplay(repoId: number, repoPath: string | null): { repoName: string; repoPath: string } {
  if (repoId === GENERAL_CHAT_PROJECT_ID) {
    return { repoName: GENERAL_CHAT_PROJECT_NAME, repoPath: GENERAL_CHAT_PROJECT_PATH }
  }
  return { repoName: repoNameFromPath(repoPath ?? ''), repoPath: repoPath ?? '' }
}

export async function listAllAutomationJobsWithRepos(pb: PocketBase): Promise<AutomationJobWithRepo[]> {
  const jobs = await pb.collection('automation_jobs').getFullList({ sort: 'created_at' })
  const projects = await pb.collection('projects').getFullList({ fields: 'id,directory' })
  const projectMap = new Map((projects as unknown as Array<{ id: string; directory: string }>).map(r => [r.id, r]))

  return (jobs as unknown as AutomationJobRecord[]).map((job) => {
    const proj = projectMap.get(job.repo_id)
    const jobObj = rowToAutomationJob(job)
    return {
      ...jobObj,
      ...resolveRepoDisplay(parseInt(job.repo_id, 10), proj?.directory ?? null),
      repoUrl: '',
    }
  })
}

export interface AutomationRunWithContext extends AutomationRun {
  jobName: string
  repoName: string
  repoPath: string
}

export interface ListAllRunsOptions {
  limit?: number
  offset?: number
  status?: string
  repoId?: number
  jobId?: number
  triggerSource?: string
}

export async function listAllAutomationRuns(pb: PocketBase, options: ListAllRunsOptions = {}): Promise<AutomationRunWithContext[]> {
  const { limit = 50, offset = 0, status, repoId, jobId, triggerSource } = options
  const filters: string[] = []

  if (status) filters.push(`status = "${status}"`)
  if (repoId !== undefined) filters.push(`repo_id = "${toPbId(repoId)}"`)
  if (jobId !== undefined) filters.push(`job_id = "${toPbId(jobId)}"`)
  if (triggerSource) filters.push(`trigger_source = "${triggerSource}"`)

  const filter = filters.length > 0 ? filters.join(' && ') : ''
  const result = await pb.collection('automation_runs').getList(1, limit, {
    filter,
    sort: '-started_at',
    skip: offset,
    expand: 'job_id,repo_id',
  })

  const jobs = await pb.collection('automation_jobs').getFullList({ fields: 'id,name' })
  const projects = await pb.collection('projects').getFullList({ fields: 'id,directory' })
  const jobMap = new Map((jobs as unknown as Array<{ id: string; name: string }>).map(j => [j.id, j.name]))
  const projectMap = new Map((projects as unknown as Array<{ id: string; directory: string }>).map(r => [r.id, r.directory]))

  return (result.items as unknown as AutomationRunRecord[]).map((run) => {
    const runObj = rowToAutomationRun(run)
    return {
      ...runObj,
      jobName: jobMap.get(run.job_id) ?? '',
      ...resolveRepoDisplay(parseInt(run.repo_id, 10), projectMap.get(run.repo_id) ?? null),
    }
  })
}
