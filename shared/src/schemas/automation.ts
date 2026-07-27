import { z } from 'zod'

export const AutomationRunTriggerSourceSchema = z.enum(['manual', 'automation'])
export type AutomationRunTriggerSource = z.infer<typeof AutomationRunTriggerSourceSchema>

export const AutomationRunStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled'])
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>

export const AutomationModeSchema = z.enum(['interval', 'cron'])
export type AutomationMode = z.infer<typeof AutomationModeSchema>

export const AutomationSkillMetadataSchema = z.object({
  skillSlugs: z.array(z.string().min(1).max(100)).default([]),
  notes: z.string().max(2000).optional(),
})
export type AutomationSkillMetadata = z.infer<typeof AutomationSkillMetadataSchema>

export const AutomationJobSchema = z.object({
  id: z.number(),
  repoId: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  automationMode: AutomationModeSchema,
  intervalMinutes: z.number().int().min(5).max(10080).nullable(),
  cronExpression: z.string().nullable(),
  timezone: z.string().nullable(),
  agentSlug: z.string().nullable(),
  prompt: z.string(),
  model: z.string().nullable(),
  skillMetadata: AutomationSkillMetadataSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
})
export type AutomationJob = z.infer<typeof AutomationJobSchema>

export const AutomationRunSchema = z.object({
  id: z.number(),
  jobId: z.number(),
  repoId: z.number(),
  triggerSource: AutomationRunTriggerSourceSchema,
  status: AutomationRunStatusSchema,
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  createdAt: z.number(),
  sessionId: z.string().nullable(),
  sessionTitle: z.string().nullable(),
  logText: z.string().nullable(),
  responseText: z.string().nullable(),
  errorText: z.string().nullable(),
})
export type AutomationRun = z.infer<typeof AutomationRunSchema>

const AutomationJobBaseRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  agentSlug: z.string().min(1).max(100).optional(),
  prompt: z.string().min(1).max(20000),
  model: z.string().min(1).max(200).optional(),
  skillMetadata: AutomationSkillMetadataSchema.nullable().optional(),
})

export const CreateAutomationJobRequestSchema = z.discriminatedUnion('automationMode', [
  AutomationJobBaseRequestSchema.extend({
    automationMode: z.literal('interval'),
    intervalMinutes: z.number().int().min(5).max(10080),
  }),
  AutomationJobBaseRequestSchema.extend({
    automationMode: z.literal('cron'),
    cronExpression: z.string().min(1).max(200),
    timezone: z.string().min(1).max(120),
  }),
])
export type CreateAutomationJobRequest = z.infer<typeof CreateAutomationJobRequestSchema>

export const UpdateAutomationJobRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  automationMode: AutomationModeSchema.optional(),
  intervalMinutes: z.number().int().min(5).max(10080).nullable().optional(),
  cronExpression: z.string().min(1).max(200).nullable().optional(),
  timezone: z.string().min(1).max(120).nullable().optional(),
  agentSlug: z.string().min(1).max(100).nullable().optional(),
  prompt: z.string().min(1).max(20000).optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  skillMetadata: AutomationSkillMetadataSchema.nullable().optional(),
})
export type UpdateAutomationJobRequest = z.infer<typeof UpdateAutomationJobRequestSchema>

export const PromptTemplateSchema = z.object({
  id: z.number(),
  title: z.string(),
  category: z.string(),
  cadenceHint: z.string(),
  suggestedName: z.string(),
  suggestedDescription: z.string(),
  description: z.string(),
  prompt: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>

export const CreatePromptTemplateRequestSchema = z.object({
  title: z.string().min(1).max(120).transform((s) => s.trim()),
  category: z.string().min(1).max(60).transform((s) => s.trim()),
  cadenceHint: z.string().min(1).max(60).transform((s) => s.trim()),
  suggestedName: z.string().min(1).max(120).transform((s) => s.trim()),
  suggestedDescription: z.string().max(500).default('').transform((s) => s.trim()),
  description: z.string().max(500).default('').transform((s) => s.trim()),
  prompt: z.string().min(1).max(20000).transform((s) => s.trim()),
})
export type CreatePromptTemplateRequest = z.infer<typeof CreatePromptTemplateRequestSchema>

export const UpdatePromptTemplateRequestSchema = CreatePromptTemplateRequestSchema.partial()
export type UpdatePromptTemplateRequest = z.infer<typeof UpdatePromptTemplateRequestSchema>

const AutomationOutputNameSchema = z.string().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_]*$/)
const AutomationTemplateSchema = z.string().max(20000)

export const AutomationConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('payload_field'), config: z.object({ field: z.string().min(1).max(200) }) }),
  z.object({ type: z.literal('equals'), config: z.object({ field: z.string().min(1).max(200), value: z.unknown() }) }),
  z.object({ type: z.literal('not_equals'), config: z.object({ field: z.string().min(1).max(200), value: z.unknown() }) }),
  z.object({ type: z.literal('exists'), config: z.object({ field: z.string().min(1).max(200), exists: z.boolean().default(true) }) }),
  z.object({ type: z.literal('matches_regex'), config: z.object({ field: z.string().min(1).max(200), pattern: z.string().min(1).max(500) }) }),
])
export type AutomationCondition = z.infer<typeof AutomationConditionSchema>

export const AutomationTriggerSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().optional(), type: z.literal('schedule'), enabled: z.boolean().default(true), position: z.number().int().min(0), config: z.object({ preset: z.enum(['hourly', 'daily', 'weekdays', 'weekly', 'monthly']), timezone: z.string().min(1).max(120), cronExpression: z.string().min(1).max(200) }), conditions: z.array(AutomationConditionSchema).max(30).default([]), nextRunAt: z.number().nullable().optional() }),
  z.object({ id: z.string().optional(), type: z.literal('cron'), enabled: z.boolean().default(true), position: z.number().int().min(0), config: z.object({ expression: z.string().min(1).max(200), timezone: z.string().min(1).max(120) }), conditions: z.array(AutomationConditionSchema).max(30).default([]), nextRunAt: z.number().nullable().optional() }),
  z.object({ id: z.string().optional(), type: z.literal('webhook'), enabled: z.boolean().default(true), position: z.number().int().min(0), config: z.object({ token: z.string().min(32).optional(), tokenCreated: z.boolean().optional() }), conditions: z.array(AutomationConditionSchema).max(30).default([]), nextRunAt: z.number().nullable().optional() }),
])
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>

export const AutomationStepSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().optional(), type: z.literal('agent'), position: z.number().int().min(0), config: z.object({ agentSlug: z.string().min(1).max(100).optional(), model: z.string().min(1).max(200).optional(), prompt: AutomationTemplateSchema.min(1), skillMetadata: AutomationSkillMetadataSchema.optional(), outputName: AutomationOutputNameSchema.optional() }) }),
  z.object({ id: z.string().optional(), type: z.literal('notification'), position: z.number().int().min(0), config: z.object({ destination: z.string().min(1).max(300), message: AutomationTemplateSchema.min(1) }) }),
  z.object({ id: z.string().optional(), type: z.literal('wait_for_input'), position: z.number().int().min(0), config: z.object({ prompt: z.string().min(1).max(2000), inputType: z.enum(['text', 'boolean', 'choice']), choices: z.array(z.string().min(1).max(200)).max(50).optional(), outputName: AutomationOutputNameSchema }) }),
])
export type AutomationStep = z.infer<typeof AutomationStepSchema>

export const AutomationDefinitionSchema = z.object({
  id: z.string(), projectId: z.string(), name: z.string().min(1).max(120), description: z.string().max(500), icon: z.string().min(1).max(80), enabled: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
  triggers: z.array(AutomationTriggerSchema).max(30), steps: z.array(AutomationStepSchema).min(1).max(100),
})
export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>

const AutomationDefinitionInputSchema = AutomationDefinitionSchema.omit({ id: true, projectId: true, createdAt: true, updatedAt: true }).extend({ updatedAt: z.number().optional() })
export const CreateAutomationDefinitionRequestSchema = AutomationDefinitionInputSchema
export type CreateAutomationDefinitionRequest = z.infer<typeof CreateAutomationDefinitionRequestSchema>
export const UpdateAutomationDefinitionRequestSchema = AutomationDefinitionInputSchema
export type UpdateAutomationDefinitionRequest = z.infer<typeof UpdateAutomationDefinitionRequestSchema>

export const AutomationDefinitionRunStatusSchema = z.enum(['running', 'waiting_for_input', 'completed', 'failed', 'cancelled', 'skipped'])
export type AutomationDefinitionRunStatus = z.infer<typeof AutomationDefinitionRunStatusSchema>
export const AutomationStepRunStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'waiting_for_input', 'cancelled', 'skipped'])
export type AutomationStepRunStatus = z.infer<typeof AutomationStepRunStatusSchema>
export const AutomationDefinitionRunSchema = z.object({ id: z.string(), automationId: z.string(), projectId: z.string(), triggerId: z.string().nullable(), triggerType: z.enum(['manual', 'schedule', 'cron', 'webhook']), status: AutomationDefinitionRunStatusSchema, startedAt: z.number(), finishedAt: z.number().nullable(), sessionId: z.string().nullable(), responseText: z.string().nullable(), errorText: z.string().nullable() })
export type AutomationDefinitionRun = z.infer<typeof AutomationDefinitionRunSchema>
