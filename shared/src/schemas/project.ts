import { z } from 'zod'

export const ProjectStatusSchema = z.enum(['ready', 'error'])

export const ProjectSchema = z.object({
  id: z.number(),
  name: z.string(),
  directory: z.string(),
  fullPath: z.string(),
  piConfigName: z.string().optional(),
  agentNames: z.array(z.string()).optional(),
  hasAgentOverride: z.boolean().optional(),
  status: ProjectStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  lastAccessedAt: z.number().optional(),
  isGeneralChat: z.boolean().optional(),
})

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1).max(256),
  directory: z.string().max(1024).optional(),
  piConfigName: z.string().optional(),
  agentNames: z.array(z.string()).optional(),
})

export const UpdateProjectRequestSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  directory: z.string().max(1024).optional(),
  piConfigName: z.string().optional(),
  agentNames: z.array(z.string()).optional(),
})

export const GeneralChatStatusSchema = z.object({
  isInitialized: z.boolean(),
  files: z.array(z.object({
    path: z.string(),
    exists: z.boolean(),
    content: z.string().optional(),
  })),
  agents: z.array(z.object({
    name: z.string(),
    icon: z.string().optional(),
    description: z.string().optional(),
  })),
  skills: z.array(z.string()),
})

export const GeneralChatInitRequestSchema = z.object({
  overwriteAgentsMd: z.boolean().optional(),
  overwritePiConfig: z.boolean().optional(),
})
