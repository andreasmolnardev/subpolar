import { z } from 'zod'

export const PiTargetStateSchema = z.enum([
  'missing',
  'starting',
  'healthy',
  'unhealthy',
  'failed',
  'stopped',
])

export const PiTargetSchema = z.object({
  repoId: z.number(),
  state: PiTargetStateSchema,
  openCodeUrl: z.string().optional(),
  token: z.string().optional(),
  startedAt: z.number().optional(),
  lastUsedAt: z.number().optional(),
  lastError: z.string().optional(),
  reused: z.boolean(),
})

export const EnsurePiTargetRequestSchema = z.object({
  workspaceId: z.string().optional(),
  clientId: z.string().optional(),
})

export const EnsurePiTargetResponseSchema = z.object({
  repoId: z.number(),
  state: PiTargetStateSchema,
  openCodeUrl: z.string(),
  headers: z.record(z.string(), z.string()),
  reused: z.boolean(),
})

export const SyncRepoSessionRequestSchema = z.object({
  sessionId: z.string(),
  reason: z.enum(['idle', 'completed', 'stop', 'manual']),
})

export const SyncRepoSessionResponseSchema = z.object({
  repoId: z.number(),
  sessionId: z.string(),
  replayedEvents: z.number(),
})
