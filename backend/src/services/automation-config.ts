import { Cron } from 'croner'
import type {
  CreateAutomationJobRequest,
  AutomationJob,
  AutomationMode,
  AutomationSkillMetadata,
  UpdateAutomationJobRequest,
} from '@subpolar/shared/types'

const DEFAULT_CRON_TIMEZONE = 'UTC'

export interface AutomationJobPersistenceInput {
  name: string
  description: string | null
  enabled: boolean
  automationMode: AutomationMode
  intervalMinutes: number | null
  cronExpression: string | null
  timezone: string | null
  agentSlug: string | null
  prompt: string
  model: string | null
  skillMetadata: AutomationSkillMetadata | null | undefined
  nextRunAt: number | null
}

function validateTimeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return timezone
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`)
  }
}

function getCronNextRunAt(cronExpression: string, timezone: string, currentDate: number): number {
  const cron = new Cron(cronExpression, { timezone })
  const next = cron.nextRun(new Date(currentDate))
  if (!next) {
    throw new Error(`Cron expression "${cronExpression}" has no upcoming run`)
  }
  return next.getTime()
}

function normalizeCronConfig(cronExpression: string, timezone: string | null | undefined, currentDate: number) {
  const normalizedTimezone = validateTimeZone(timezone?.trim() || DEFAULT_CRON_TIMEZONE)
  const normalizedCronExpression = cronExpression.trim()
  const nextRunAt = getCronNextRunAt(normalizedCronExpression, normalizedTimezone, currentDate)

  return {
    automationMode: 'cron' as const,
    intervalMinutes: null,
    cronExpression: normalizedCronExpression,
    timezone: normalizedTimezone,
    nextRunAt,
  }
}

function normalizeIntervalConfig(intervalMinutes: number, currentDate: number) {
  return {
    automationMode: 'interval' as const,
    intervalMinutes,
    cronExpression: null,
    timezone: null,
    nextRunAt: currentDate + intervalMinutes * 60_000,
  }
}

export function computeNextRunAtForJob(job: AutomationJob, currentDate: number): number | null {
  if (!job.enabled) {
    return null
  }

  if (job.automationMode === 'cron') {
    if (!job.cronExpression) {
      throw new Error('Cron expression is required for cron automations')
    }

    return getCronNextRunAt(job.cronExpression, job.timezone || DEFAULT_CRON_TIMEZONE, currentDate)
  }

  if (!job.intervalMinutes) {
    throw new Error('Interval minutes are required for interval automations')
  }

  return currentDate + job.intervalMinutes * 60_000
}

export function buildCreateAutomationPersistenceInput(input: CreateAutomationJobRequest, currentDate: number = Date.now()): AutomationJobPersistenceInput {
  const base = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    enabled: input.enabled !== false,
    agentSlug: input.agentSlug?.trim() || null,
    prompt: input.prompt.trim(),
    model: input.model?.trim() || null,
    skillMetadata: input.skillMetadata,
  }

  const automationConfig = input.automationMode === 'cron'
    ? normalizeCronConfig(input.cronExpression, input.timezone, currentDate)
    : normalizeIntervalConfig(input.intervalMinutes, currentDate)

  return {
    ...base,
    ...automationConfig,
    nextRunAt: base.enabled ? automationConfig.nextRunAt : null,
  }
}

export function buildUpdatedAutomationPersistenceInput(
  existing: AutomationJob,
  input: UpdateAutomationJobRequest,
  currentDate: number = Date.now(),
): AutomationJobPersistenceInput {
  const enabled = input.enabled ?? existing.enabled
  const automationMode = input.automationMode ?? existing.automationMode

  const automationConfig = automationMode === 'cron'
    ? normalizeCronConfig(
        input.cronExpression ?? existing.cronExpression ?? '',
        input.timezone ?? existing.timezone ?? DEFAULT_CRON_TIMEZONE,
        currentDate,
      )
    : normalizeIntervalConfig(
        input.intervalMinutes ?? existing.intervalMinutes ?? 60,
        currentDate,
      )

  const automationChanged =
    input.automationMode !== undefined ||
    input.intervalMinutes !== undefined ||
    input.cronExpression !== undefined ||
    input.timezone !== undefined

  const nextRunAt = enabled
    ? automationChanged || input.enabled !== undefined || existing.nextRunAt === null
      ? automationConfig.nextRunAt
      : existing.nextRunAt
    : null

  return {
    name: input.name?.trim() || existing.name,
    description: input.description === undefined ? existing.description : (input.description?.trim() || null),
    enabled,
    automationMode: automationConfig.automationMode,
    intervalMinutes: automationConfig.intervalMinutes,
    cronExpression: automationConfig.cronExpression,
    timezone: automationConfig.timezone,
    agentSlug: input.agentSlug === undefined ? existing.agentSlug : (input.agentSlug?.trim() || null),
    prompt: input.prompt?.trim() || existing.prompt,
    model: input.model === undefined ? existing.model : (input.model?.trim() || null),
    skillMetadata: input.skillMetadata !== undefined ? input.skillMetadata : existing.skillMetadata,
    nextRunAt,
  }
}
