import { describe, expect, it } from 'vitest'
import type { AutomationJob } from '@subpolar/shared/types'
import {
  buildCreateAutomationPersistenceInput,
  buildUpdatedAutomationPersistenceInput,
  computeNextRunAtForJob,
} from '../../src/services/automation-config'

describe('automation-config', () => {
  it('builds interval automation persistence input with trimmed fields', () => {
    const currentDate = Date.UTC(2026, 2, 9, 12, 0, 0)

    const result = buildCreateAutomationPersistenceInput({
      name: '  Daily health check  ',
      description: '  Summarize repo health  ',
      enabled: true,
      automationMode: 'interval',
      intervalMinutes: 60,
      prompt: '  Review the repository and summarize risks.  ',
      agentSlug: '  code  ',
      model: '  openai/gpt-5  ',
    }, currentDate)

    expect(result).toEqual({
      name: 'Daily health check',
      description: 'Summarize repo health',
      enabled: true,
      automationMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: 'code',
      prompt: 'Review the repository and summarize risks.',
      model: 'openai/gpt-5',
      skillMetadata: undefined,
      nextRunAt: currentDate + 60 * 60_000,
    })
  })

  it('defaults cron automations to UTC and computes the next run', () => {
    const currentDate = Date.UTC(2026, 2, 9, 8, 15, 0)

    const result = buildCreateAutomationPersistenceInput({
      name: 'Morning report',
      enabled: true,
      automationMode: 'cron',
      cronExpression: ' 0 9 * * * ',
      timezone: '   ',
      prompt: 'Generate the daily report.',
    }, currentDate)

    expect(result.automationMode).toBe('cron')
    expect(result.cronExpression).toBe('0 9 * * *')
    expect(result.timezone).toBe('UTC')
    expect(result.nextRunAt).toBe(Date.UTC(2026, 2, 9, 9, 0, 0))
  })

  it('preserves the existing next run when only prompt text changes', () => {
    const existing: AutomationJob = {
      id: 7,
      repoId: 42,
      name: 'Weekly engineering summary',
      description: 'Summarize health',
      enabled: true,
      automationMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Old prompt',
      model: null,
      skillMetadata: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: Date.UTC(2026, 2, 9, 12, 0, 0),
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedAutomationPersistenceInput(existing, {
      prompt: '  New prompt body  ',
    }, Date.UTC(2026, 2, 9, 12, 30, 0))

    expect(result.prompt).toBe('New prompt body')
    expect(result.nextRunAt).toBe(existing.nextRunAt)
  })

  it('normalizes optional text fields when updating a automation', () => {
    const existing: AutomationJob = {
      id: 10,
      repoId: 42,
      name: 'Weekly engineering summary',
      description: 'Existing description',
      enabled: true,
      automationMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: 'planner',
      prompt: 'Old prompt',
      model: 'openai/gpt-5-mini',
      skillMetadata: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: Date.UTC(2026, 2, 9, 12, 0, 0),
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedAutomationPersistenceInput(existing, {
      description: '   ',
      agentSlug: '  reviewer  ',
      model: '   ',
    }, Date.UTC(2026, 2, 9, 12, 30, 0))

    expect(result.description).toBeNull()
    expect(result.agentSlug).toBe('reviewer')
    expect(result.model).toBeNull()
  })

  it('recomputes the next run when a disabled automation is re-enabled', () => {
    const existing: AutomationJob = {
      id: 8,
      repoId: 42,
      name: 'Paused summary',
      description: null,
      enabled: false,
      automationMode: 'interval',
      intervalMinutes: 30,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Run a report',
      model: null,
      skillMetadata: null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const currentDate = Date.UTC(2026, 2, 9, 14, 0, 0)
    const result = buildUpdatedAutomationPersistenceInput(existing, {
      enabled: true,
    }, currentDate)

    expect(result.enabled).toBe(true)
    expect(result.nextRunAt).toBe(currentDate + 30 * 60_000)
  })

  it('throws for invalid cron timezones', () => {
    expect(() => buildCreateAutomationPersistenceInput({
      name: 'Invalid timezone',
      enabled: true,
      automationMode: 'cron',
      cronExpression: '0 9 * * *',
      timezone: 'Mars/Phobos',
      prompt: 'Test prompt',
    }, Date.UTC(2026, 2, 9, 8, 0, 0))).toThrow('Invalid timezone: Mars/Phobos')
  })

  it('returns null for disabled jobs when computing the next run', () => {
    const job: AutomationJob = {
      id: 9,
      repoId: 42,
      name: 'Disabled summary',
      description: null,
      enabled: false,
      automationMode: 'interval',
      intervalMinutes: 15,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    expect(computeNextRunAtForJob(job, Date.UTC(2026, 2, 9, 12, 0, 0))).toBeNull()
  })
})
