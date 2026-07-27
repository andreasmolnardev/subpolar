import { Hono } from 'hono'
import {
  CreateAutomationDefinitionRequestSchema,
  UpdateAutomationDefinitionRequestSchema,
  type AutomationCondition,
  type AutomationDefinition,
} from '@subpolar/shared/schemas'
import {
  createAutomationDefinitionRun,
  deleteAutomationDefinition,
  findWebhookTrigger,
  getAutomationDefinition,
  getAutomationDefinitionById,
  listAutomationDefinitionRuns,
  listAutomationDefinitions,
  saveAutomationDefinition,
} from '../db/automation-definitions'
import type { Database } from '../db/schema'
import { getProjectById } from '../db/projects'

function failure(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

function validateDefinition(definition: { steps: Array<{ type: string; config: Record<string, unknown> }>; triggers: Array<{ conditions: AutomationCondition[] }> }): void {
  const names = new Set<string>()
  for (const step of definition.steps) {
    const outputName = typeof step.config.outputName === 'string' ? step.config.outputName : undefined
    const templates = [step.config.prompt, step.config.message].filter((value): value is string => typeof value === 'string')
    for (const template of templates) {
      for (const reference of template.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)) {
        if (!names.has(reference[1]!)) throw new Error(`Unknown prior output: ${reference[1]}`)
      }
    }
    if (outputName) {
      if (names.has(outputName)) throw new Error(`Duplicate output name: ${outputName}`)
      names.add(outputName)
    }
  }
  for (const trigger of definition.triggers) {
    for (const condition of trigger.conditions) {
      if (condition.type === 'matches_regex') {
        try { new RegExp(condition.config.pattern) } catch { throw new Error('Invalid condition regular expression') }
      }
    }
  }
}

function valueAt(payload: unknown, field: string): unknown {
  return field.split('.').reduce<unknown>((value, key) => value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, payload)
}

function conditionsPass(conditions: AutomationCondition[], payload: unknown): boolean {
  return conditions.every((condition) => {
    const config = condition.config
    const value = valueAt(payload, config.field)
    if (condition.type === 'payload_field') return value !== undefined
    if (condition.type === 'exists') return (value !== undefined) === config.exists
    if (condition.type === 'equals') return JSON.stringify(value) === JSON.stringify(config.value)
    if (condition.type === 'not_equals') return JSON.stringify(value) !== JSON.stringify(config.value)
    return typeof value === 'string' && new RegExp(config.pattern).test(value)
  })
}

async function definitionForProject(db: Database, projectId: string, automationId: string): Promise<AutomationDefinition | null> {
  const project = await getProjectById(db, projectId)
  if (!project) return null
  return getAutomationDefinition(db, projectId, automationId)
}

export function createProjectAutomationRoutes(db: Database) {
  const app = new Hono()
  app.get('/', async (c) => c.json({ automations: await listAutomationDefinitions(db, c.req.param('id')) }))
  app.post('/', async (c) => {
    try {
      const projectId = c.req.param('id')
      if (!await getProjectById(db, projectId)) return failure('Project not found', 404)
      const input = CreateAutomationDefinitionRequestSchema.parse(await c.req.json())
      validateDefinition(input)
      const result = await saveAutomationDefinition(db, projectId, input)
      return c.json({ automation: result.definition, webhookTokens: result.webhookTokens }, 201)
    } catch (error) { return failure(error instanceof Error ? error.message : 'Invalid automation definition') }
  })
  app.get('/:automationId', async (c) => {
    const automation = await definitionForProject(db, c.req.param('id'), c.req.param('automationId'))
    return automation ? c.json({ automation }) : failure('Automation not found', 404)
  })
  app.patch('/:automationId', async (c) => {
    try {
      const input = UpdateAutomationDefinitionRequestSchema.parse(await c.req.json())
      validateDefinition(input)
      const result = await saveAutomationDefinition(db, c.req.param('id'), input, c.req.param('automationId'))
      return c.json({ automation: result.definition, webhookTokens: result.webhookTokens })
    } catch (error) { return failure(error instanceof Error ? error.message : 'Invalid automation definition') }
  })
  app.delete('/:automationId', async (c) => {
    const deleted = await deleteAutomationDefinition(db, c.req.param('id'), c.req.param('automationId'))
    return deleted ? c.json({ success: true }) : failure('Automation not found', 404)
  })
  app.post('/:automationId/run', async (c) => {
    const automation = await definitionForProject(db, c.req.param('id'), c.req.param('automationId'))
    if (!automation) return failure('Automation not found', 404)
    const run = await createAutomationDefinitionRun(db, automation, null, 'manual', {})
    return c.json({ run }, 201)
  })
  app.get('/:automationId/runs', async (c) => {
    const automation = await definitionForProject(db, c.req.param('id'), c.req.param('automationId'))
    return automation ? c.json({ runs: await listAutomationDefinitionRuns(db, automation.id) }) : failure('Automation not found', 404)
  })
  return app
}

export function createAutomationWebhookRoutes(db: Database) {
  const app = new Hono()
  app.post('/:token', async (c) => {
    const contentLength = Number(c.req.header('content-length') ?? 0)
    if (contentLength > 65_536) return failure('Webhook payload is too large', 413)
    const trigger = await findWebhookTrigger(db, c.req.param('token'))
    if (!trigger || !trigger.enabled) return failure('Webhook not found', 404)
    let payload: unknown
    try { payload = await c.req.json() } catch { return failure('Webhook payload must be valid JSON') }
    const automation = await getAutomationDefinitionById(db, String(trigger.automation_id))
    if (!automation) return failure('Automation not found', 404)
    const definitionTrigger = automation.triggers.find((item) => item.id === trigger.id)
    if (!definitionTrigger || !conditionsPass(definitionTrigger.conditions, payload)) {
      const run = await createAutomationDefinitionRun(db, automation, trigger.id, 'webhook', { received: true }, 'skipped', 'Trigger conditions did not pass')
      return c.json({ run }, 202)
    }
    const run = await createAutomationDefinitionRun(db, automation, trigger.id, 'webhook', { received: true })
    return c.json({ run }, 202)
  })
  return app
}
