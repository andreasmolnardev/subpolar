import type { Database } from 'bun:sqlite'
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
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_NAME, ASSISTANT_REPO_PATH } from '@subpolar/shared/utils'
import type { AutomationJobPersistenceInput } from '../services/automation-config'

interface AutomationJobRow {
  id: number
  repo_id: number
  name: string
  description: string | null
  enabled: number
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

interface AutomationRunRow {
  id: number
  job_id: number
  repo_id: number
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

function parseSkillMetadata(raw: string | null) {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    const result = AutomationSkillMetadataSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function rowToAutomationJob(row: AutomationJobRow): AutomationJob {
  return AutomationJobSchema.parse({
    id: row.id,
    repoId: row.repo_id,
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

function rowToAutomationRun(row: AutomationRunRow): AutomationRun {
  return AutomationRunSchema.parse({
    id: row.id,
    jobId: row.job_id,
    repoId: row.repo_id,
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
  if (!skillMetadata) {
    return null
  }

  return JSON.stringify(skillMetadata)
}

export function listAutomationJobsByRepo(db: Database, repoId: number): AutomationJob[] {
  const stmt = db.prepare('SELECT * FROM automation_jobs WHERE repo_id = ? ORDER BY created_at DESC')
  const rows = stmt.all(repoId) as AutomationJobRow[]
  return rows.map(rowToAutomationJob)
}

export function listAutomationJobIdsByRepo(db: Database, repoId: number): number[] {
  const stmt = db.prepare('SELECT id FROM automation_jobs WHERE repo_id = ? ORDER BY created_at DESC')
  const rows = stmt.all(repoId) as Array<{ id: number }>
  return rows.map((row) => row.id)
}

export function listEnabledAutomationJobs(db: Database): AutomationJob[] {
  const stmt = db.prepare('SELECT * FROM automation_jobs WHERE enabled = 1 ORDER BY id ASC')
  const rows = stmt.all() as AutomationJobRow[]
  return rows.map(rowToAutomationJob)
}

export function getAutomationJobById(db: Database, repoId: number, jobId: number): AutomationJob | null {
  const stmt = db.prepare('SELECT * FROM automation_jobs WHERE repo_id = ? AND id = ?')
  const row = stmt.get(repoId, jobId) as AutomationJobRow | undefined
  return row ? rowToAutomationJob(row) : null
}

export function createAutomationJob(db: Database, repoId: number, input: AutomationJobPersistenceInput): AutomationJob {
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO automation_jobs (
      repo_id, name, description, enabled, automation_mode, interval_minutes, cron_expression, timezone, agent_slug, prompt, model, skill_metadata,
      created_at, updated_at, last_run_at, next_run_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    repoId,
    input.name,
    input.description ?? null,
    input.enabled ? 1 : 0,
    input.automationMode,
    input.intervalMinutes,
    input.cronExpression,
    input.timezone,
    input.agentSlug ?? null,
    input.prompt,
    input.model ?? null,
    serializeSkillMetadata(input.skillMetadata),
    now,
    now,
    null,
    input.nextRunAt,
  )

  const job = getAutomationJobById(db, repoId, Number(result.lastInsertRowid))
  if (!job) {
    throw new Error('Failed to load created automation job')
  }
  return job
}

export function updateAutomationJob(db: Database, repoId: number, jobId: number, input: AutomationJobPersistenceInput): AutomationJob | null {
  const existing = getAutomationJobById(db, repoId, jobId)
  if (!existing) {
    return null
  }

  const now = Date.now()

  const stmt = db.prepare(`
    UPDATE automation_jobs
    SET name = ?, description = ?, enabled = ?, automation_mode = ?, interval_minutes = ?, cron_expression = ?, timezone = ?, agent_slug = ?, prompt = ?, model = ?, skill_metadata = ?, updated_at = ?, next_run_at = ?
    WHERE repo_id = ? AND id = ?
  `)

  stmt.run(
    input.name,
    input.description,
    input.enabled ? 1 : 0,
    input.automationMode,
    input.intervalMinutes,
    input.cronExpression,
    input.timezone,
    input.agentSlug,
    input.prompt,
    input.model,
    serializeSkillMetadata(input.skillMetadata),
    now,
    input.nextRunAt,
    repoId,
    jobId,
  )

  return getAutomationJobById(db, repoId, jobId)
}

export function deleteAutomationJob(db: Database, repoId: number, jobId: number): boolean {
  db.prepare('DELETE FROM automation_runs WHERE repo_id = ? AND job_id = ?').run(repoId, jobId)
  const stmt = db.prepare('DELETE FROM automation_jobs WHERE repo_id = ? AND id = ?')
  const result = stmt.run(repoId, jobId)
  return result.changes > 0
}

export function cleanupOrphanedAutomations(db: Database): { orphanedJobs: number; orphanedRuns: number } {
  const runStmt = db.prepare(`
    DELETE FROM automation_runs
    WHERE (repo_id != ? AND repo_id NOT IN (SELECT id FROM repos))
       OR job_id NOT IN (SELECT id FROM automation_jobs)
  `)
  const orphanedRuns = runStmt.run(ASSISTANT_REPO_ID).changes

  const jobStmt = db.prepare(`
    DELETE FROM automation_jobs
    WHERE repo_id != ? AND repo_id NOT IN (SELECT id FROM repos)
  `)
  const orphanedJobs = jobStmt.run(ASSISTANT_REPO_ID).changes

  return { orphanedJobs, orphanedRuns }
}

export function updateAutomationJobRunState(db: Database, repoId: number, jobId: number, values: { lastRunAt: number; nextRunAt?: number | null }): void {
  const stmt = db.prepare('UPDATE automation_jobs SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE repo_id = ? AND id = ?')
  stmt.run(values.lastRunAt, values.nextRunAt ?? null, Date.now(), repoId, jobId)
}

export function createAutomationRun(
  db: Database,
  input: {
    jobId: number
    repoId: number
    triggerSource: AutomationRunTriggerSource
    status: AutomationRunStatus
    startedAt: number
    createdAt: number
  },
): AutomationRun {
  const stmt = db.prepare(`
    INSERT INTO automation_runs (job_id, repo_id, trigger_source, status, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    input.jobId,
    input.repoId,
    input.triggerSource,
    input.status,
    input.startedAt,
    input.createdAt,
  )

  const run = getAutomationRunById(db, input.repoId, input.jobId, Number(result.lastInsertRowid))
  if (!run) {
    throw new Error('Failed to load created automation run')
  }
  return run
}

export function updateAutomationRun(
  db: Database,
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
): AutomationRun | null {
  const stmt = db.prepare(`
    UPDATE automation_runs
    SET status = ?, finished_at = ?, session_id = ?, session_title = ?, log_text = ?, response_text = ?, error_text = ?
    WHERE repo_id = ? AND job_id = ? AND id = ?
  `)

  stmt.run(
    input.status,
    input.finishedAt,
    input.sessionId ?? null,
    input.sessionTitle ?? null,
    input.logText ?? null,
    input.responseText ?? null,
    input.errorText ?? null,
    repoId,
    jobId,
    runId,
  )

  return getAutomationRunById(db, repoId, jobId, runId)
}

export function updateAutomationRunMetadata(
  db: Database,
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
): AutomationRun | null {
  const existing = getAutomationRunById(db, repoId, jobId, runId)
  if (!existing) {
    return null
  }

  const stmt = db.prepare(`
    UPDATE automation_runs
    SET session_id = ?, session_title = ?, log_text = ?, response_text = ?, error_text = ?
    WHERE repo_id = ? AND job_id = ? AND id = ?
  `)

  stmt.run(
    input.sessionId === undefined ? existing.sessionId : input.sessionId,
    input.sessionTitle === undefined ? existing.sessionTitle : input.sessionTitle,
    input.logText === undefined ? existing.logText : input.logText,
    input.responseText === undefined ? existing.responseText : input.responseText,
    input.errorText === undefined ? existing.errorText : input.errorText,
    repoId,
    jobId,
    runId,
  )

  return getAutomationRunById(db, repoId, jobId, runId)
}

export function getAutomationRunById(db: Database, repoId: number, jobId: number, runId: number): AutomationRun | null {
  const stmt = db.prepare('SELECT * FROM automation_runs WHERE repo_id = ? AND job_id = ? AND id = ?')
  const row = stmt.get(repoId, jobId, runId) as AutomationRunRow | undefined
  return row ? rowToAutomationRun(row) : null
}

export function getRunningAutomationRunByJob(db: Database, repoId: number, jobId: number): AutomationRun | null {
  const stmt = db.prepare(`
    SELECT * FROM automation_runs
    WHERE repo_id = ? AND job_id = ? AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `)
  const row = stmt.get(repoId, jobId) as AutomationRunRow | undefined
  return row ? rowToAutomationRun(row) : null
}

export function listRunningAutomationRuns(db: Database, limit: number = 100): AutomationRun[] {
  const stmt = db.prepare(`
    SELECT * FROM automation_runs
    WHERE status = 'running'
    ORDER BY started_at ASC
    LIMIT ?
  `)
  const rows = stmt.all(limit) as AutomationRunRow[]
  return rows.map(rowToAutomationRun)
}

export function listAutomationRunsByJob(db: Database, repoId: number, jobId: number, limit: number = 20): AutomationRun[] {
  const stmt = db.prepare(`
    SELECT
      id,
      job_id,
      repo_id,
      trigger_source,
      status,
      started_at,
      finished_at,
      created_at,
      session_id,
      session_title,
      NULL AS log_text,
      NULL AS response_text,
      error_text
    FROM automation_runs
    WHERE repo_id = ? AND job_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `)
  const rows = stmt.all(repoId, jobId, limit) as AutomationRunRow[]
  return rows.map(rowToAutomationRun)
}

export interface AutomationJobWithRepo extends AutomationJob {
  repoName: string
  repoPath: string
  repoUrl: string
}

interface AutomationJobWithRepoRow extends AutomationJobRow {
  repo_url: string | null
  repo_path: string | null
}

function repoNameFromPath(repoPath: string): string {
  if (!repoPath || repoPath === '/') return 'Unknown'
  return repoPath.split(/[\\/]/).pop() ?? repoPath
}

function resolveRepoDisplay(repoId: number, repoPath: string | null): { repoName: string; repoPath: string } {
  if (repoId === ASSISTANT_REPO_ID) {
    return { repoName: ASSISTANT_REPO_NAME, repoPath: ASSISTANT_REPO_PATH }
  }
  return { repoName: repoNameFromPath(repoPath ?? ''), repoPath: repoPath ?? '' }
}

function rowToAutomationJobWithRepo(row: AutomationJobWithRepoRow): AutomationJobWithRepo {
  return {
    ...rowToAutomationJob(row),
    ...resolveRepoDisplay(row.repo_id, row.repo_path),
    repoUrl: row.repo_url ?? '',
  }
}

export function listAllAutomationJobsWithRepos(db: Database): AutomationJobWithRepo[] {
  const stmt = db.prepare(`
    SELECT aj.*, r.repo_url, r.local_path as repo_path
    FROM automation_jobs aj
    LEFT JOIN repos r ON aj.repo_id = r.id
    ORDER BY COALESCE(r.local_path, ''), aj.name
  `)
  const rows = stmt.all() as AutomationJobWithRepoRow[]
  return rows.map(rowToAutomationJobWithRepo)
}

export interface AutomationRunWithContext extends AutomationRun {
  jobName: string
  repoName: string
  repoPath: string
}

interface AutomationRunWithContextRow extends AutomationRunRow {
  job_name: string
  repo_path: string | null
}

function rowToAutomationRunWithContext(row: AutomationRunWithContextRow): AutomationRunWithContext {
  return {
    ...rowToAutomationRun(row),
    jobName: row.job_name,
    ...resolveRepoDisplay(row.repo_id, row.repo_path),
  }
}

export interface ListAllRunsOptions {
  limit?: number
  offset?: number
  status?: string
  repoId?: number
  jobId?: number
  triggerSource?: string
}

export function listAllAutomationRuns(db: Database, options: ListAllRunsOptions = {}): AutomationRunWithContext[] {
  const { limit = 50, offset = 0, status, repoId, jobId, triggerSource } = options
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (status) {
    conditions.push('ar.status = ?')
    params.push(status)
  }
  if (repoId !== undefined) {
    conditions.push('ar.repo_id = ?')
    params.push(repoId)
  }
  if (jobId !== undefined) {
    conditions.push('ar.job_id = ?')
    params.push(jobId)
  }
  if (triggerSource) {
    conditions.push('ar.trigger_source = ?')
    params.push(triggerSource)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const stmt = db.prepare(`
    SELECT
      ar.id, ar.job_id, ar.repo_id, ar.trigger_source, ar.status,
      ar.started_at, ar.finished_at, ar.created_at,
      ar.session_id, ar.session_title,
      NULL AS log_text, NULL AS response_text, ar.error_text,
      aj.name AS job_name, r.local_path AS repo_path
    FROM automation_runs ar
    JOIN automation_jobs aj ON ar.job_id = aj.id
    LEFT JOIN repos r ON ar.repo_id = r.id
    ${whereClause}
    ORDER BY ar.started_at DESC
    LIMIT ? OFFSET ?
  `)

  params.push(limit, offset)
  const rows = stmt.all(...params) as AutomationRunWithContextRow[]
  return rows.map(rowToAutomationRunWithContext)
}
