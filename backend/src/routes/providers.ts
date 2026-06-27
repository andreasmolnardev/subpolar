import { Hono } from 'hono'
import { z } from 'zod'
import path from 'path'
import { AuthService } from '../services/auth'
import { PiCustomProviderService } from '../services/pi-providers'
import { SetCredentialRequestSchema } from '../../../shared/src/schemas/auth'
import { logger } from '../utils/logger'
import type { Database } from '../db/schema'
import { getWorkspacePath } from '@subpolar/shared/config/env'
import {
  addRecentPiInternalModel,
  getPiInternalModelState as readModelStateFromDb,
  removeRecentPiInternalModel,
  toggleFavoritePiInternalModel,
  type PiInternalModelStateRecord,
} from '../db/model-state'
import { writeJsonAtomic, withFileLock } from '../utils/atomic-json'

export const ModelSelectionSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
})

export const ModelStateSchema = z.object({
  recent: z.array(ModelSelectionSchema).default([]),
  favorite: z.array(ModelSelectionSchema).default([]),
  variant: z.record(z.string(), z.string().optional()).default({}),
})

const UpdateModelStateSchema = z.object({
  recent: ModelSelectionSchema.optional(),
  favorite: ModelSelectionSchema.optional(),
  removeRecent: ModelSelectionSchema.optional(),
}).strict()

const DiscoverCustomProviderModelsSchema = z.object({
  baseUrl: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
})

const LmStudioModelSchema = z.object({
  id: z.string().trim().min(1),
})

const LmStudioModelsResponseSchema = z.object({
  data: z.array(LmStudioModelSchema).default([]),
})

export function getModelStatePath(): string {
  return path.join(getWorkspacePath(), '.opencode', 'state', 'opencode', 'model.json')
}

function getLmStudioModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = url.pathname.replace(/\/(?:api\/)?v1\/?$/, '')
  const root = url.toString().endsWith('/') ? url.toString() : `${url.toString()}/`
  return new URL('v1/models', root).toString()
}

async function mirrorModelStateToFile(state: PiInternalModelStateRecord): Promise<void> {
  const modelStatePath = getModelStatePath()
  try {
    await withFileLock(modelStatePath, async () => {
      await writeJsonAtomic(modelStatePath, {
        recent: state.recent,
        favorite: state.favorite,
        variant: state.variant,
      })
    })
  } catch (error) {
    logger.warn(`Failed to mirror model state to file ${modelStatePath}:`, error)
  }
}

export function createProvidersRoutes(db: Database) {
  const app = new Hono()
  const authService = new AuthService()
  const customProviderService = new PiCustomProviderService()

  app.get('/model-state', async (c) => {
    try {
      const state = await readModelStateFromDb(db)
      return c.json(state)
    } catch (error) {
      logger.error('Failed to read PiInternal model state from DB:', error)
      return c.json({ recent: [], favorite: [], variant: {} })
    }
  })

  app.post('/model-state', async (c) => {
    try {
      const body = await c.req.json()
      const validated = UpdateModelStateSchema.parse(body)
      
      let nextState: PiInternalModelStateRecord
      
      if (validated.favorite) {
        nextState = await toggleFavoritePiInternalModel(db, validated.favorite)
      } else if (validated.recent) {
        nextState = await addRecentPiInternalModel(db, validated.recent)
      } else if (validated.removeRecent) {
        nextState = await removeRecentPiInternalModel(db, validated.removeRecent)
      } else {
        nextState = await readModelStateFromDb(db)
      }
      
      await mirrorModelStateToFile(nextState)
      
      return c.json(nextState)
    } catch (error) {
      logger.error('Failed to update PiInternal model state:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode model state' }, 500)
    }
  })

  app.get('/credentials', async (c) => {
    try {
      const providers = await authService.list()
      return c.json({ providers })
    } catch (error) {
      logger.error('Failed to list provider credentials:', error)
      return c.json({ error: 'Failed to list provider credentials' }, 500)
    }
  })

  app.get('/:id/credentials/status', async (c) => {
    try {
      const providerId = c.req.param('id')
      const hasCredentials = await authService.has(providerId)
      return c.json({ hasCredentials })
    } catch (error) {
      logger.error('Failed to check credential status:', error)
      return c.json({ error: 'Failed to check credential status' }, 500)
    }
  })

  app.post('/:id/credentials', async (c) => {
    try {
      const providerId = c.req.param('id')
      const body = await c.req.json()
      const validated = SetCredentialRequestSchema.parse(body)

      await authService.set(providerId, validated.apiKey)

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to set provider credentials:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to set provider credentials' }, 500)
    }
  })

  app.delete('/:id/credentials', async (c) => {
    try {
      const providerId = c.req.param('id')

      await authService.delete(providerId)

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete provider credentials:', error)
      return c.json({ error: 'Failed to delete provider credentials' }, 500)
    }
  })

  app.get('/custom', async (c) => {
    try {
      return c.json({ providers: await customProviderService.list() })
    } catch (error) {
      logger.error('Failed to list custom providers:', error)
      return c.json({ error: 'Failed to list custom providers' }, 500)
    }
  })

  app.post('/custom', async (c) => {
    try {
      const provider = await customProviderService.upsert(await c.req.json())
      return c.json({ provider })
    } catch (error) {
      logger.error('Failed to save custom provider:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to save custom provider' }, 500)
    }
  })

  app.post('/custom/discover-models', async (c) => {
    try {
      const body = DiscoverCustomProviderModelsSchema.parse(await c.req.json())
      const headers: Record<string, string> = {}
      if (body.apiKey) headers.Authorization = `Bearer ${body.apiKey}`

      const modelsUrl = getLmStudioModelsUrl(body.baseUrl)
      logger.info(`Discovering LM Studio models from ${modelsUrl} with authorization header: ${headers.Authorization ? 'yes' : 'no'}`)

      const response = await fetch(modelsUrl, { headers })
      logger.info(`LM Studio model discovery returned HTTP ${response.status}`)
      if (!response.ok) {
        return c.json({ error: `LM Studio returned ${response.status}` }, 502)
      }

      const parsed = LmStudioModelsResponseSchema.parse(await response.json())
      const models = parsed.data.map((model) => model.id)
      logger.info(`LM Studio model discovery parsed ${models.length} model${models.length === 1 ? '' : 's'}: ${models.join(', ')}`)

      return c.json({ models })
    } catch (error) {
      logger.error('Failed to discover custom provider models:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to discover custom provider models' }, 500)
    }
  })

  app.delete('/custom/:id', async (c) => {
    try {
      const deleted = await customProviderService.delete(c.req.param('id'))
      return c.json({ success: true, deleted })
    } catch (error) {
      logger.error('Failed to delete custom provider:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid provider id', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to delete custom provider' }, 500)
    }
  })

  return app
}
