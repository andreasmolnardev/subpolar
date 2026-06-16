import type { Database } from '../db/schema'
import { Cron } from 'croner'
import {
  type CreateAutomationJobRequest,
  type AutomationJob,
  type AutomationRun,
  type AutomationRunTriggerSource,
  type UpdateAutomationJobRequest,
} from '@subpolar/shared/types'
import { getProjectById } from '../db/projects'
import type { AutomationJobWithRepo } from '../db/automations'
import {
  cleanupOrphanedAutomations,
  createAutomationJob,
  createAutomationRun,
  deleteAutomationJob,
  getAutomationJobById,
  getRunningAutomationRunByJob,
  getAutomationRunById,
  listAllAutomationJobsWithRepos,
  listAllAutomationRuns,
  listEnabledAutomationJobs,
  listAutomationJobIdsByRepo,
  listAutomationJobsByRepo,
  listRunningAutomationRuns,
  listAutomationRunsByJob,
  updateAutomationJob,
  updateAutomationJobRunState,
  updateAutomationRun,
  updateAutomationRunMetadata,
} from '../db/automations'
import type { ListAllRunsOptions, AutomationRunWithContext } from '../db/automations'
import {
  buildCreateAutomationPersistenceInput,
  buildUpdatedAutomationPersistenceInput,
  computeNextRunAtForJob,
} from './automation-config'
import { resolveOpenCodeModel } from './opencode-models'
import type { OpenCodeClient } from './opencode/client'
import { sseAggregator, type SSEEvent } from './sse-aggregator'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { buildGeneralChatProject } from './assistant-mode'
import { GENERAL_CHAT_PROJECT_ID } from '@subpolar/shared/utils'

class AutomationServiceError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface SessionResponse {
  id: string
}

interface PromptResponse {
  parts?: Array<{
    type?: string
    text?: string
  }>
}

interface SessionMessagePart {
  type?: string
  text?: string
}

interface SessionMessage {
  info?: {
    id?: string
    sessionID?: string
    role?: string
    time?: {
      created?: number
      completed?: number
    }
    error?: {
      name?: string
      data?: {
        message?: string
      }
    }
  }
  parts?: SessionMessagePart[]
}

interface SessionStatus {
  type: 'idle' | 'retry' | 'busy'
  attempt?: number
  message?: string
  next?: number
}

const RUN_POLL_INTERVAL_MS = 2_000
const RUN_POLL_TIMEOUT_MS = 5 * 60_000

interface SessionMonitor {
  getErrorText(): string | null
  isIdle(): boolean
  dispose(): void
}

function extractResponseText(response: PromptResponse): string {
  return (response.parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

function buildSessionTitle(job: AutomationJob): string {
  return `automationd: ${job.name}`
}

type SkillInfo = {
  name: string
  description: string
  location: string
  content: string
}

async function fetchSkillContent(slugs: string[], repoPath: string, openCodeClient: OpenCodeClient): Promise<string[]> {
  try {
    const response = await openCodeClient.forward({
      method: 'GET',
      path: '/skill',
      directory: repoPath,
    })
    if (!response.ok) {
      logger.warn(`Failed to fetch skills from OpenCode (${response.status}), falling back to name-only injection`)
      return []
    }
    const skills = await response.json() as SkillInfo[]

    const skillBlocks = slugs
      .map((slug) => {
        const skill = skills.find((s) => s.name === slug || s.name.endsWith(`/${slug}`) || s.name.endsWith(`-${slug}`))
        if (!skill) {
          logger.warn(`Skill "${slug}" not found in OpenCode skill list`)
          return null
        }
        return [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          '',
          skill.content.trim(),
          '</skill_content>',
        ].join('\n')
      })
      .filter((block): block is string => block !== null)

    const foundCount = skillBlocks.length
    if (foundCount < slugs.length) {
      logger.warn(`Only ${foundCount} of ${slugs.length} requested skills were found`)
    }

    return skillBlocks
  } catch (error) {
    logger.warn('Error fetching skills from OpenCode, falling back to name-only injection:', error)
    return []
  }
}

async function buildPromptWithSkills(
  prompt: string,
  skillMetadata: AutomationJob['skillMetadata'],
  repoPath: string,
  openCodeClient: OpenCodeClient,
): Promise<string> {
  if (!skillMetadata || !skillMetadata.skillSlugs || skillMetadata.skillSlugs.length === 0) return prompt

  const skillBlocks = await fetchSkillContent(skillMetadata.skillSlugs, repoPath, openCodeClient)
  const notesLine = skillMetadata.notes ? `\nSkill notes: ${skillMetadata.notes}` : ''

  if (skillBlocks.length === 0) {
    const skillList = skillMetadata.skillSlugs.join(', ')
    return `${prompt}\n\nFor this task, use the following skills: ${skillList}${notesLine}`
  }

  return `${prompt}\n\nThe following skills have been loaded for this task:\n\n${skillBlocks.join('\n\n')}${notesLine}`
}

function buildRunLog(input: {
  job: AutomationJob
  triggerSource: AutomationRunTriggerSource
  sessionId?: string | null
  sessionTitle?: string | null
  responseText?: string | null
  errorText?: string | null
  finishedAt: number
}): string {
  const automationLabel = input.job.automationMode === 'cron'
    ? `${input.job.cronExpression ?? ''} (${input.job.timezone ?? 'UTC'})`
    : `every ${input.job.intervalMinutes ?? 0} minutes`

  const lines = [
    `Job: ${input.job.name}`,
    `Trigger: ${input.triggerSource}`,
    `Finished: ${new Date(input.finishedAt).toISOString()}`,
    `Agent: ${input.job.agentSlug ?? 'default'}`,
    `automation: ${automationLabel}`,
  ]

  if (input.sessionId) {
    lines.push(`Session ID: ${input.sessionId}`)
  }

  if (input.sessionTitle) {
    lines.push(`Session title: ${input.sessionTitle}`)
  }

  if (input.errorText) {
    lines.push('', 'Error:', input.errorText)
  }

  if (input.responseText) {
    lines.push('', 'Assistant output:', input.responseText)
  }

  return lines.join('\n')
}

function buildRunStartedLog(input: {
  job: AutomationJob
  triggerSource: AutomationRunTriggerSource
  sessionId: string
  sessionTitle: string
}): string {
  const automationLabel = input.job.automationMode === 'cron'
    ? `${input.job.cronExpression ?? ''} (${input.job.timezone ?? 'UTC'})`
    : `every ${input.job.intervalMinutes ?? 0} minutes`

  return [
    `Job: ${input.job.name}`,
    `Trigger: ${input.triggerSource}`,
    `Started: ${new Date().toISOString()}`,
    `Agent: ${input.job.agentSlug ?? 'default'}`,
    `automation: ${automationLabel}`,
    `Session ID: ${input.sessionId}`,
    `Session title: ${input.sessionTitle}`,
    '',
    'Run started. Waiting for assistant response...',
  ].join('\n')
}

function parsePromptResponse(responseText: string): PromptResponse | null {
  if (!responseText.trim()) {
    return null
  }

  try {
    return JSON.parse(responseText) as PromptResponse
  } catch {
    return null
  }
}

function extractAssistantMessageText(parts: SessionMessagePart[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

function getAssistantMessageState(messages: SessionMessage[]): {
  responseText: string | null
  errorText: string | null
  completed: boolean
} | null {
  const assistantMessage = [...messages]
    .reverse()
    .find((message) => message.info?.role === 'assistant')

  if (!assistantMessage) {
    return null
  }

  return {
    responseText: extractAssistantMessageText(assistantMessage.parts) || null,
    errorText: assistantMessage.info?.error?.data?.message ?? assistantMessage.info?.error?.name ?? null,
    completed: Boolean(assistantMessage.info?.time?.completed),
  }
}

function getSessionEventId(event: SSEEvent): string | null {
  const properties = event.properties as {
    sessionID?: string
    info?: { id?: string }
  }

  return properties.sessionID ?? properties.info?.id ?? null
}

function getSessionErrorText(event: SSEEvent): string | null {
  const properties = event.properties as {
    error?: {
      name?: string
      data?: {
        message?: string
      }
    }
  }

  return properties.error?.data?.message ?? properties.error?.name ?? null
}

function getSessionStatusType(event: SSEEvent): string | null {
  const properties = event.properties as {
    status?: {
      type?: string
    }
  }

  return properties.status?.type ?? null
}

function createSessionMonitor(directory: string, sessionId: string): SessionMonitor {
  let errorText: string | null = null
  let idle = false

  const unsubscribe = sseAggregator.onEvent((eventDirectory, event) => {
    if (eventDirectory !== directory) {
      return
    }

    if (getSessionEventId(event) !== sessionId) {
      return
    }

    if (event.type === 'session.error') {
      errorText = getSessionErrorText(event) ?? 'The session reported an unknown error.'
      return
    }

    if (event.type === 'session.idle') {
      idle = true
      return
    }

    if (event.type === 'session.status' && getSessionStatusType(event) === 'idle') {
      idle = true
    }
  })

  return {
    getErrorText: () => errorText,
    isIdle: () => idle,
    dispose: unsubscribe,
  }
}

export class AutomationService {
  private static activeRuns = new Set<number>()
  private onJobChange: ((job: AutomationJob | null, jobId: number) => void) | null = null

  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
  ) {}

  setJobChangeHandler(handler: ((job: AutomationJob | null, jobId: number) => void) | null): void {
    this.onJobChange = handler
  }

  async listAllEnabledJobs(): Promise<AutomationJob[]> {
    return await listEnabledAutomationJobs(this.db)
  }

  async listAllJobsWithRepos(): Promise<AutomationJobWithRepo[]> {
    return await listAllAutomationJobsWithRepos(this.db)
  }

  async listAllRuns(options: ListAllRunsOptions = {}): Promise<AutomationRunWithContext[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
    const offset = Math.max(options.offset ?? 0, 0)
    return await listAllAutomationRuns(this.db, { ...options, limit, offset })
  }

  async recoverRunningRuns(): Promise<void> {
    const runningRuns = await listRunningAutomationRuns(this.db)

    for (const run of runningRuns) {
      const job = await getAutomationJobById(this.db, run.repoId, run.jobId)
      if (!job) {
        continue
      }

      if (AutomationService.activeRuns.has(job.id)) {
        continue
      }

      AutomationService.activeRuns.add(job.id)
      await this.recoverRunningRun(job, run)
    }
  }

  async listJobs(repoId: number): Promise<AutomationJob[]> {
    await this.assertRepo(repoId)
    return await listAutomationJobsByRepo(this.db, repoId)
  }

  async getJob(repoId: number, jobId: number): Promise<AutomationJob | null> {
    return await getAutomationJobById(this.db, repoId, jobId)
  }

  async createJob(repoId: number, input: CreateAutomationJobRequest): Promise<AutomationJob> {
    await this.assertRepo(repoId)

    try {
      const job = await createAutomationJob(this.db, repoId, buildCreateAutomationPersistenceInput(input))
      this.onJobChange?.(job, job.id)
      return job
    } catch (error) {
      throw new AutomationServiceError(getErrorMessage(error), 400)
    }
  }

  async updateJob(repoId: number, jobId: number, input: UpdateAutomationJobRequest): Promise<AutomationJob> {
    await this.assertRepo(repoId)
    const existing = await this.assertJob(repoId, jobId)
    let job: AutomationJob | null

    try {
      job = await updateAutomationJob(this.db, repoId, jobId, buildUpdatedAutomationPersistenceInput(existing, input))
    } catch (error) {
      throw new AutomationServiceError(getErrorMessage(error), 400)
    }

    if (!job) {
      throw new AutomationServiceError('Automation not found', 404)
    }
    this.onJobChange?.(job, job.id)
    return job
  }

  async deleteJob(repoId: number, jobId: number): Promise<void> {
    await this.assertRepo(repoId)
    const deleted = await deleteAutomationJob(this.db, repoId, jobId)
    if (!deleted) {
      throw new AutomationServiceError('Automation not found', 404)
    }
    this.onJobChange?.(null, jobId)
  }

  async prepareRepoDelete(repoId: number): Promise<void> {
    const jobIds = await listAutomationJobIdsByRepo(this.db, repoId)
    for (const jobId of jobIds) {
      this.onJobChange?.(null, jobId)
    }
  }

  async cleanupOrphanedAutomations(): Promise<{ orphanedJobs: number; orphanedRuns: number }> {
    const result = await cleanupOrphanedAutomations(this.db)
    if (result.orphanedJobs > 0 || result.orphanedRuns > 0) {
      logger.info(`Cleaned up ${result.orphanedJobs} orphaned automation job(s) and ${result.orphanedRuns} run(s)`)
    }
    return result
  }

  async listRuns(repoId: number, jobId: number, limit: number = 20): Promise<AutomationRun[]> {
    await this.assertJob(repoId, jobId)
    return await listAutomationRunsByJob(this.db, repoId, jobId, limit)
  }

  async getRun(repoId: number, jobId: number, runId: number): Promise<AutomationRun> {
    await this.assertJob(repoId, jobId)
    const run = await getAutomationRunById(this.db, repoId, jobId, runId)
    if (!run) {
      throw new AutomationServiceError('Run not found', 404)
    }
    return run
  }

  async runJob(repoId: number, jobId: number, triggerSource: AutomationRunTriggerSource): Promise<AutomationRun> {
    const repo = await this.assertRepo(repoId)
    const job = await this.assertJob(repoId, jobId)

    const existingRunningRun = await getRunningAutomationRunByJob(this.db, repoId, jobId)
    if (existingRunningRun) {
      throw new AutomationServiceError('Automation is already running', 409)
    }

    if (AutomationService.activeRuns.has(jobId)) {
      throw new AutomationServiceError('Automation is already running', 409)
    }

    AutomationService.activeRuns.add(jobId)

    const startedAt = Date.now()
    const run = await createAutomationRun(this.db, {
      jobId,
      repoId,
      triggerSource,
      status: 'running',
      startedAt,
      createdAt: startedAt,
    })

    try {
      const model = await resolveOpenCodeModel(this.openCodeClient, repo.fullPath, {
        preferredModel: job.model,
      })
      const sessionTitle = buildSessionTitle(job)
      const sessionResponse = await this.openCodeClient.forward({
        method: 'POST',
        path: '/session',
        directory: repo.fullPath,
        body: JSON.stringify({
          title: sessionTitle,
          agent: job.agentSlug ?? undefined,
        }),
        headers: { 'Content-Type': 'application/json' },
      })

      if (!sessionResponse.ok) {
        throw new AutomationServiceError('Failed to create OpenCode session', 502)
      }

      const session = await sessionResponse.json() as SessionResponse
      const runWithSession = await updateAutomationRunMetadata(this.db, repoId, jobId, run.id, {
        sessionId: session.id,
        sessionTitle,
        logText: buildRunStartedLog({
          job,
          triggerSource,
          sessionId: session.id,
          sessionTitle,
        }),
      })

      if (!runWithSession) {
        throw new AutomationServiceError('Failed to attach session to run', 500)
      }

      const sessionMonitor = createSessionMonitor(repo.fullPath, session.id)

      void this.submitPromptAndMonitor({
        repoId,
        job,
        runId: run.id,
        sessionId: session.id,
        sessionTitle,
        triggerSource,
        model,
        sessionMonitor,
      })

      return runWithSession
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to run automation ${jobId}:`, error)

      const failedRun = await updateAutomationRun(this.db, repoId, jobId, run.id, {
        status: 'failed',
        finishedAt,
        errorText,
        logText: buildRunLog({
          job,
          triggerSource,
          errorText,
          finishedAt,
        }),
      })

      try {
        await updateAutomationJobRunState(this.db, repoId, jobId, {
          lastRunAt: finishedAt,
          nextRunAt: triggerSource === 'manual' ? job.nextRunAt : computeNextRunAtForJob(job, finishedAt),
        })
      } catch (updateError) {
        logger.error(`Failed to update job state for job ${jobId}:`, updateError)
      }

      if (!failedRun) {
        AutomationService.activeRuns.delete(jobId)
        throw new AutomationServiceError('Failed to load failed run', 500)
      }

      if (error instanceof AutomationServiceError) {
        AutomationService.activeRuns.delete(jobId)
        throw error
      }

      AutomationService.activeRuns.delete(jobId)
      throw new AutomationServiceError(errorText, 500)
    }
  }

  async cancelRun(repoId: number, jobId: number, runId: number): Promise<AutomationRun> {
    const repo = await this.assertRepo(repoId)
    const job = await this.assertJob(repoId, jobId)
    const run = await this.getRun(repoId, jobId, runId)

    if (run.status !== 'running') {
      throw new AutomationServiceError('Only running automation runs can be cancelled', 409)
    }

    if (run.sessionId) {
      const messages = await this.listSessionMessages(repo.fullPath, run.sessionId)
      const assistantState = getAssistantMessageState(messages)

      if (assistantState?.completed || assistantState?.errorText) {
        await this.finalizeRecoveredRun(job, run, {
          status: assistantState.errorText ? 'failed' : 'completed',
          responseText: assistantState.responseText,
          errorText: assistantState.errorText,
        })

        return await this.getRun(repoId, jobId, runId)
      }

      const abortResponse = await this.openCodeClient.forward({
        method: 'POST',
        path: `/session/${run.sessionId}/abort`,
        directory: repo.fullPath,
      })

      if (!abortResponse.ok) {
        const errorText = await abortResponse.text()
        throw new AutomationServiceError(errorText || 'Failed to cancel automation run', 502)
      }
    }

    const finishedAt = Date.now()
    const cancellationMessage = 'Run cancelled by user.'
    const cancelledRun = await updateAutomationRun(this.db, repoId, jobId, runId, {
      status: 'cancelled',
      finishedAt,
      sessionId: run.sessionId,
      sessionTitle: run.sessionTitle,
      errorText: cancellationMessage,
      responseText: run.responseText,
      logText: buildRunLog({
        job,
        triggerSource: run.triggerSource,
        sessionId: run.sessionId,
        sessionTitle: run.sessionTitle,
        responseText: run.responseText,
        errorText: cancellationMessage,
        finishedAt,
      }),
    })

    await updateAutomationJobRunState(this.db, repoId, jobId, {
      lastRunAt: finishedAt,
      nextRunAt: job.nextRunAt,
    })

    AutomationService.activeRuns.delete(jobId)

    if (!cancelledRun) {
      throw new AutomationServiceError('Failed to update cancelled run', 500)
    }

    return cancelledRun
  }

  private async submitPromptAndMonitor(input: {
    repoId: number
    job: AutomationJob
    runId: number
    sessionId: string
    sessionTitle: string
    triggerSource: AutomationRunTriggerSource
    model: { providerID: string; modelID: string }
    sessionMonitor: SessionMonitor
  }): Promise<void> {
    const repo = await this.assertRepo(input.repoId)

    try {
      const promptResponse = await this.openCodeClient.forward({
        method: 'POST',
        path: `/session/${input.sessionId}/message`,
        directory: repo.fullPath,
        body: JSON.stringify({
          parts: [{ type: 'text', text: await buildPromptWithSkills(input.job.prompt, input.job.skillMetadata, repo.fullPath, this.openCodeClient) }],
          model: input.model,
        }),
        headers: { 'Content-Type': 'application/json' },
      })

      if (!promptResponse.ok) {
        const errorText = await promptResponse.text()
        throw new AutomationServiceError(errorText || 'Failed to run automationd prompt', 502)
      }

      const promptBody = await promptResponse.text()
      const promptResult = parsePromptResponse(promptBody)

      if (promptResult) {
        const currentRun = await getAutomationRunById(this.db, input.repoId, input.job.id, input.runId)
        if (!currentRun || currentRun.status !== 'running') {
          return
        }

        const finishedAt = Date.now()
        const responseText = extractResponseText(promptResult)
        await updateAutomationRun(this.db, input.repoId, input.job.id, input.runId, {
          status: 'completed',
          finishedAt,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          responseText,
          logText: buildRunLog({
            job: input.job,
            triggerSource: input.triggerSource,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            responseText,
            finishedAt,
          }),
        })

        await updateAutomationJobRunState(this.db, input.repoId, input.job.id, {
          lastRunAt: finishedAt,
          nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
        })

        return
      }

      await this.monitorRunCompletion({
        sessionMonitor: input.sessionMonitor,
        repoId: input.repoId,
        job: input.job,
        runId: input.runId,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        triggerSource: input.triggerSource,
      })
      return
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to submit prompt for automation ${input.job.id}:`, error)

      const currentRun = await getAutomationRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      await updateAutomationRun(this.db, input.repoId, input.job.id, input.runId, {
        status: 'failed',
        finishedAt,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        errorText,
        logText: buildRunLog({
          job: input.job,
          triggerSource: input.triggerSource,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText,
          finishedAt,
        }),
      })

      await updateAutomationJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } finally {
      input.sessionMonitor.dispose()
      AutomationService.activeRuns.delete(input.job.id)
    }
  }

  private async monitorRunCompletion(input: {
    sessionMonitor: SessionMonitor
    repoId: number
    job: AutomationJob
    runId: number
    sessionId: string
    sessionTitle: string
    triggerSource: AutomationRunTriggerSource
    initialSessionStatus?: SessionStatus
  }): Promise<void> {
    try {
      const sessionStatus = input.initialSessionStatus
      if (sessionStatus && sessionStatus.type === 'idle') {
        const repo = await this.assertRepo(input.repoId)
        const messages = await this.listSessionMessages(repo.fullPath, input.sessionId)
        const assistantState = getAssistantMessageState(messages)
        if (assistantState?.completed || assistantState?.errorText) {
          await this.finalizeRecoveredRun(input.job, {
            id: input.runId,
            repoId: input.repoId,
            jobId: input.job.id,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            triggerSource: input.triggerSource,
          } as AutomationRun, {
            status: assistantState.errorText ? 'failed' : 'completed',
            responseText: assistantState.responseText,
            errorText: assistantState.errorText,
          })
          return
        }
      }

      const repo = await this.assertRepo(input.repoId)
      const currentMessages = await this.listSessionMessages(repo.fullPath, input.sessionId)
      const currentAssistantState = getAssistantMessageState(currentMessages)
      if (currentAssistantState?.completed || currentAssistantState?.errorText) {
        await this.finalizeRecoveredRun(input.job, {
          id: input.runId,
          repoId: input.repoId,
          jobId: input.job.id,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          triggerSource: input.triggerSource,
        } as AutomationRun, {
          status: currentAssistantState.errorText ? 'failed' : 'completed',
          responseText: currentAssistantState.responseText,
          errorText: currentAssistantState.errorText,
        })
        return
      }

      const response = await this.waitForAssistantMessage(input.job, input.sessionId, input.sessionMonitor)
      const currentRun = await getAutomationRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      const finishedAt = Date.now()

      if (response.errorText) {
        await updateAutomationRun(this.db, input.repoId, input.job.id, input.runId, {
          status: 'failed',
          finishedAt,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText: response.errorText,
          responseText: response.responseText,
          logText: buildRunLog({
            job: input.job,
            triggerSource: input.triggerSource,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            responseText: response.responseText,
            errorText: response.errorText,
            finishedAt,
          }),
        })
      } else {
        await updateAutomationRun(this.db, input.repoId, input.job.id, input.runId, {
          status: 'completed',
          finishedAt,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          responseText: response.responseText,
          logText: buildRunLog({
            job: input.job,
            triggerSource: input.triggerSource,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            responseText: response.responseText,
            finishedAt,
          }),
        })
      }

      await updateAutomationJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to monitor automation ${input.job.id}:`, error)

      const currentRun = await getAutomationRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      await updateAutomationRun(this.db, input.repoId, input.job.id, input.runId, {
        status: 'failed',
        finishedAt,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        errorText,
        logText: buildRunLog({
          job: input.job,
          triggerSource: input.triggerSource,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText,
          finishedAt,
        }),
      })

      await updateAutomationJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } finally {
      input.sessionMonitor.dispose()
      AutomationService.activeRuns.delete(input.job.id)
    }
  }

  private async recoverRunningRun(job: AutomationJob, run: AutomationRun): Promise<void> {
    try {
      const repo = await this.assertRepo(job.repoId)

      if (!run.sessionId) {
        await this.finalizeRecoveredRun(job, run, {
          status: 'failed',
          errorText: 'This run was interrupted before completion and had no linked session to recover.',
        })
        return
      }

      const messages = await this.listSessionMessages(repo.fullPath, run.sessionId)
      const assistantState = getAssistantMessageState(messages)

      if (assistantState?.completed || assistantState?.errorText) {
        await this.finalizeRecoveredRun(job, run, {
          status: assistantState.errorText ? 'failed' : 'completed',
          responseText: assistantState.responseText,
          errorText: assistantState.errorText,
        })
        return
      }

      const sessionStatuses = await this.getSessionStatuses(repo.fullPath)
      const sessionStatus = run.sessionId ? sessionStatuses[run.sessionId] : undefined

      if (sessionStatus && sessionStatus.type !== 'idle') {
        const sessionMonitor = createSessionMonitor(repo.fullPath, run.sessionId)
        void this.monitorRunCompletion({
          sessionMonitor,
          repoId: run.repoId,
          job,
          runId: run.id,
          sessionId: run.sessionId,
          sessionTitle: run.sessionTitle ?? buildSessionTitle(job),
          triggerSource: run.triggerSource,
          initialSessionStatus: sessionStatus,
        })
        return
      }

      await this.finalizeRecoveredRun(job, run, {
        status: 'failed',
        responseText: assistantState?.responseText ?? null,
        errorText: 'This run was interrupted before completion, likely because subpolar restarted while it was in progress. Open the linked session to inspect the partial output and rerun if needed.',
      })
    } catch (error) {
      const errorText = getErrorMessage(error)
      logger.error(`Failed to recover automation ${job.id}:`, error)
      await this.finalizeRecoveredRun(job, run, {
        status: 'failed',
        errorText,
      })
    }
  }

  private async finalizeRecoveredRun(
    job: AutomationJob,
    run: AutomationRun,
    input: {
      status: 'completed' | 'failed'
      responseText?: string | null
      errorText?: string | null
    },
  ): Promise<void> {
    const finishedAt = Date.now()

    await updateAutomationRun(this.db, run.repoId, run.jobId, run.id, {
      status: input.status,
      finishedAt,
      sessionId: run.sessionId,
      sessionTitle: run.sessionTitle,
      responseText: input.responseText,
      errorText: input.errorText,
      logText: buildRunLog({
        job,
        triggerSource: run.triggerSource,
        sessionId: run.sessionId,
        sessionTitle: run.sessionTitle,
        responseText: input.responseText,
        errorText: input.errorText,
        finishedAt,
      }),
    })

    await updateAutomationJobRunState(this.db, run.repoId, run.jobId, {
      lastRunAt: finishedAt,
      nextRunAt: run.triggerSource === 'manual' ? job.nextRunAt : computeNextRunAtForJob(job, finishedAt),
    })

    AutomationService.activeRuns.delete(job.id)
  }

  private async waitForAssistantMessage(
    job: AutomationJob,
    sessionId: string,
    sessionMonitor: SessionMonitor,
  ): Promise<{ responseText: string | null; errorText: string | null }> {
    const startedAt = Date.now()
    const repo = await this.assertRepo(job.repoId)

    while (Date.now() - startedAt < RUN_POLL_TIMEOUT_MS) {
      const messages = await this.listSessionMessages(repo.fullPath, sessionId)
      const assistantState = getAssistantMessageState(messages)

      if (assistantState && (assistantState.completed || assistantState.errorText)) {
        return {
          responseText: assistantState.responseText,
          errorText: assistantState.errorText,
        }
      }

      const sessionErrorText = sessionMonitor.getErrorText()
      if (sessionErrorText) {
        return {
          responseText: null,
          errorText: sessionErrorText,
        }
      }

      if (sessionMonitor.isIdle()) {
        return {
          responseText: null,
          errorText: 'The session became idle without producing an assistant response. Open the linked session to inspect any pending questions, permissions, or provider issues.',
        }
      }

      await Bun.sleep(RUN_POLL_INTERVAL_MS)
    }

    return {
      responseText: null,
      errorText: 'Timed out waiting for the assistant response. Open the linked session to inspect any pending questions, permissions, or provider issues.',
    }
  }

  private async listSessionMessages(directory: string, sessionId: string): Promise<SessionMessage[]> {
    const messagesResponse = await this.openCodeClient.forward({
      method: 'GET',
      path: `/session/${sessionId}/message`,
      directory,
    })

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text()
      throw new AutomationServiceError(errorText || 'Failed to fetch session messages', 502)
    }

    return await messagesResponse.json() as SessionMessage[]
  }

  private async getSessionStatuses(directory: string): Promise<Record<string, SessionStatus>> {
    const response = await this.openCodeClient.forward({
      method: 'GET',
      path: '/session/status',
      directory,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new AutomationServiceError(errorText || 'Failed to fetch session statuses', 502)
    }

    return await response.json() as Record<string, SessionStatus>
  }

  private async assertRepo(repoId: number) {
    if (repoId === GENERAL_CHAT_PROJECT_ID) {
      return buildGeneralChatProject()
    }
    const project = await getProjectById(this.db, String(repoId))
    if (!project) {
      throw new AutomationServiceError('Project not found', 404)
    }
    return project
  }

  private async assertJob(repoId: number, jobId: number) {
    const job = await getAutomationJobById(this.db, repoId, jobId)
    if (!job) {
      throw new AutomationServiceError('Automation not found', 404)
    }
    return job
  }
}

interface Stoppable {
  stop(): void
}

function buildIntervalCronExpression(intervalMinutes: number): string | null {
  if (intervalMinutes < 5) {
    return null
  }

  if (intervalMinutes <= 59) {
    return `*/${intervalMinutes} * * * *`
  }

  if (intervalMinutes === 60) {
    return `0 * * * *`
  }

  const hours = intervalMinutes / 60
  if (Number.isInteger(hours) && 24 % hours === 0) {
    return `0 */${hours} * * *`
  }

  const days = intervalMinutes / 1440
  if (Number.isInteger(days)) {
    return `0 0 */${days} * *`
  }

  return null
}

export class AutomationRunner {
  private cronJobs = new Map<number, Stoppable>()

  constructor(private readonly automationService: AutomationService) {}

  async start(): Promise<void> {
    this.automationService.setJobChangeHandler((job, jobId) => {
      if (job) {
        this.registerJob(job)
      } else {
        this.unregisterJob(jobId)
      }
    })

    // Clean up any automation records whose repo no longer exists.  This handles
    // leftovers from before foreign-key enforcement was enabled, and guards
    // against edge cases where a repo row was removed outside the normal flow.
    await this.automationService.cleanupOrphanedAutomations()

    await this.automationService.recoverRunningRuns()
    await this.registerAllEnabledJobs()
  }

  stop(): void {
    this.automationService.setJobChangeHandler(null)
    for (const stoppable of this.cronJobs.values()) {
      stoppable.stop()
    }
    this.cronJobs.clear()
  }

  registerJob(job: AutomationJob): void {
    this.unregisterJob(job.id)

    if (!job.enabled) {
      return
    }

    if (job.automationMode === 'cron') {
      if (!job.cronExpression) {
        return
      }
      const options: Record<string, unknown> = { protect: true }
      if (job.timezone) {
        options.timezone = job.timezone
      }
      const cron = new Cron(job.cronExpression, options, () => {
        logger.info(`Cron triggered for job ${job.id}: ${job.name}`)
        void this.executeJob(job.repoId, job.id)
      })
      this.cronJobs.set(job.id, cron)
      logger.info(`Cron job created for ${job.id}: next run at ${cron.nextRun()?.toISOString()}`)
      return
    }

    if (!job.intervalMinutes) {
      return
    }

    if (!job.nextRunAt) {
      logger.warn(`Job ${job.id} (${job.name}) has no nextRunAt, skipping registration`)
      return
    }

    const cronExpression = buildIntervalCronExpression(job.intervalMinutes)
    const options: Record<string, unknown> = { protect: true }
    if (job.timezone) {
      options.timezone = job.timezone
    }

    if (cronExpression) {
      const nextRunDate = new Date(job.nextRunAt)
      const now = new Date()

      if (nextRunDate <= now) {
        void this.executeJob(job.repoId, job.id)
      }

      const cronOptions = {
        ...options,
        ...(nextRunDate > now ? { startAt: nextRunDate.toISOString() } : {}),
      }
      const cron = new Cron(cronExpression, cronOptions, () => {
        logger.info(`Cron triggered for job ${job.id}: ${job.name}`)
        void this.executeJob(job.repoId, job.id)
      })
      this.cronJobs.set(job.id, cron)
    } else {
      const intervalMs = job.intervalMinutes * 60_000
      let timeout: ReturnType<typeof setTimeout> | null = null
      let isStopped = false
      let isRunning = false

      const automationNext = () => {
        if (isStopped || isRunning) return
        timeout = setTimeout(async () => {
          if (isStopped || isRunning) return
          isRunning = true
          logger.info(`Interval timer triggered for job ${job.id}: ${job.name}`)
          try {
            await this.executeJob(job.repoId, job.id)
          } finally {
            isRunning = false
            automationNext()
          }
        }, intervalMs)
      }

      const initialDelay = Math.max(0, job.nextRunAt - Date.now())
      if (initialDelay > 0) {
        timeout = setTimeout(() => {
          if (isStopped || isRunning) return
          isRunning = true
          logger.info(`Interval timer triggered for job ${job.id}: ${job.name}`)
          void this.executeJob(job.repoId, job.id).finally(() => {
            isRunning = false
            automationNext()
          })
        }, initialDelay)
      } else {
        if (!isStopped) {
          isRunning = true
          void this.executeJob(job.repoId, job.id).finally(() => {
            isRunning = false
            automationNext()
          })
        }
      }

      this.cronJobs.set(job.id, {
        stop: () => {
          isStopped = true
          if (timeout) clearTimeout(timeout)
        }
      })
    }
  }

  unregisterJob(jobId: number): void {
    const existing = this.cronJobs.get(jobId)
    if (existing) {
      existing.stop()
      this.cronJobs.delete(jobId)
    }
  }

  private async executeJob(repoId: number, jobId: number): Promise<void> {
    try {
      await this.automationService.runJob(repoId, jobId, 'automation')
    } catch (error) {
      logger.error(`automationd run failed for job ${jobId}:`, error)
    }
  }

  private async registerAllEnabledJobs(): Promise<void> {
    const jobs = await this.automationService.listAllEnabledJobs()
    logger.info(`Registering ${jobs.length} enabled automation jobs`)
    for (const job of jobs) {
      try {
        logger.info(`Registering job ${job.id}: ${job.name} (mode=${job.automationMode}, cron=${job.cronExpression}, tz=${job.timezone})`)
        this.registerJob(job)
        logger.info(`Job ${job.id} registered, cron jobs map size: ${this.cronJobs.size}`)
      } catch (error) {
        logger.error(`Failed to register job ${job.id}:`, error)
      }
    }
  }
}

export { AutomationServiceError }
