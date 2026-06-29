import { z } from 'zod'
import {
  PiTargetStateSchema,
  PiTargetSchema,
  EnsurePiTargetRequestSchema,
  EnsurePiTargetResponseSchema,
  SyncRepoSessionRequestSchema,
  SyncRepoSessionResponseSchema,
} from '../schemas/opencode-target'

export type PiTargetState = z.infer<typeof PiTargetStateSchema>
export type PiTarget = z.infer<typeof PiTargetSchema>
export type EnsurePiTargetRequest = z.infer<typeof EnsurePiTargetRequestSchema>
export type EnsurePiTargetResponse = z.infer<typeof EnsurePiTargetResponseSchema>
export type SyncRepoSessionRequest = z.infer<typeof SyncRepoSessionRequestSchema>
export type SyncRepoSessionResponse = z.infer<typeof SyncRepoSessionResponseSchema>
