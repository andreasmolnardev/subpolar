import { z } from 'zod'

export const RepoStatusSchema = z.enum(['cloning', 'ready', 'error'])

export const RepoSchema = z.object({
  id: z.number(),
  repoUrl: z.string().url().optional(),
  localPath: z.string(),
  fullPath: z.string(),
  sourcePath: z.string().optional(),
  branch: z.string().optional(),
  defaultBranch: z.string(),
  cloneStatus: RepoStatusSchema,
  clonedAt: z.number(),
  lastPulled: z.number().optional(),
  lastAccessedAt: z.number().optional(),
  openCodeConfigName: z.string().optional(),
  isWorktree: z.boolean().optional(),
  isLocal: z.boolean().optional(),
})

export const InternalRepoListResponseSchema = z.object({
  repos: z.array(RepoSchema),
})

export const CreateRepoRequestSchema = z.object({
  repoUrl: z.string().url().optional(),
  localPath: z.string().optional(),
  branch: z.string().optional(),
  directoryName: z.string().optional(),
  openCodeConfigName: z.string().optional(),
  useWorktree: z.boolean().optional(),
  skipSSHVerification: z.boolean().optional(),
}).refine(
  (data) => data.repoUrl || data.localPath,
  {
    message: "Either repoUrl or localPath must be provided",
    path: ["repoUrl"],
  }
)

export const DiscoverReposRequestSchema = z.object({
  rootPath: z.string().trim().min(1),
  maxDepth: z.number().int().min(0).max(8).optional(),
})

export const DiscoverReposResponseSchema = z.object({
  repos: z.array(RepoSchema),
  discoveredCount: z.number().int().nonnegative(),
  existingCount: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      path: z.string(),
      error: z.string(),
    })
  ),
})

export const GeneralChatFileSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  created: z.boolean(),
})

export const AgentFileInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  exists: z.boolean(),
  created: z.boolean(),
})

export type AgentFileInfo = z.infer<typeof AgentFileInfoSchema>

export const GeneralChatStatusSchema = z.object({
  repoId: z.number(),
  directory: z.string(),
  relativePath: z.literal('repos/assistant'),
  warnings: z.array(z.object({
    code: z.string(),
    path: z.string(),
    message: z.string(),
  })).optional(),
  files: z.object({
    agentsMd: GeneralChatFileSchema,
    opencodeJson: GeneralChatFileSchema,
  }),
  agents: z.array(AgentFileInfoSchema),
  internalToken: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  automationsSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  notificationsSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  settingsSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  repoManagementSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  codeReviewSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  codeAnalysisSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  researchWebSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  defaultAgent: AgentFileInfoSchema.optional(),
})

export const GeneralChatInitRequestSchema = z.object({
  overwriteAgentsMd: z.boolean().optional(),
  overwriteOpenCodeConfig: z.boolean().optional(),
})
