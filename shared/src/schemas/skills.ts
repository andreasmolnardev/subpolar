import { z } from 'zod'

export const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const SkillNameSchema = z.string()
  .min(1)
  .max(64)
  .regex(SKILL_NAME_REGEX, 'Skill name must be lowercase alphanumeric with hyphens only (e.g., my-skill)')

export const SkillScopeSchema = z.enum(['global', 'project'])
export type SkillScope = z.infer<typeof SkillScopeSchema>

export const SkillDiscoveryModeSchema = z.enum(['full', 'description', 'name', 'search'])
export type SkillDiscoveryMode = z.infer<typeof SkillDiscoveryModeSchema>

export const AgentSkillAccessSchema = z.object({
  id: SkillNameSchema,
  discovery: SkillDiscoveryModeSchema,
  source: z.enum(['manual', 'tool-default', 'project-auto']).optional(),
})
export type AgentSkillAccess = z.infer<typeof AgentSkillAccessSchema>

export const SkillFrontmatterSchema = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(1024),
})

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export const CreateSkillRequestSchema = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(1024),
  body: z.string(),
  scope: SkillScopeSchema,
  repoId: z.number().optional(),
})

export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>

export const UpdateSkillRequestSchema = z.object({
  description: z.string().min(1).max(1024).optional(),
  body: z.string().optional(),
})

export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>

export interface SkillFileInfo {
  name: string
  description: string
  body: string
  scope: SkillScope
  location: string
  repoId?: number
  repoName?: string
  source?: 'global' | 'project' | 'auto'
  discoveryEligible?: boolean
}
