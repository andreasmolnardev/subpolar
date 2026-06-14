import type PocketBase from 'pocketbase'
import { logger } from '../utils/logger'

export interface ModelSelectionRecord {
  providerID: string
  modelID: string
}

export interface OpenCodeModelStateRecord {
  recent: ModelSelectionRecord[]
  favorite: ModelSelectionRecord[]
  variant: Record<string, string | undefined>
}

export const MAX_RECENT_MODELS = 10

const EMPTY_STATE: OpenCodeModelStateRecord = { recent: [], favorite: [], variant: {} }

interface ModelStateRecord {
  id: string
  user_id: string
  recent: string
  favorite: string
  variant: string
  updated_at: number
}

function parseJsonSafe<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch (error) {
    logger.warn(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
}

async function ensureRecordExists(pb: PocketBase, userId: string): Promise<void> {
  try {
    await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
  } catch {
    await pb.collection('opencode_model_state').create({
      user_id: userId,
      recent: '[]',
      favorite: '[]',
      variant: '{}',
      updated_at: Date.now(),
    })
  }
}

export async function getOpenCodeModelState(pb: PocketBase, userId = 'default'): Promise<OpenCodeModelStateRecord> {
  try {
    const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
    const row = record as unknown as ModelStateRecord
    const recent = parseJsonSafe<ModelSelectionRecord[]>(row.recent, [])
    const favorite = parseJsonSafe<ModelSelectionRecord[]>(row.favorite, [])
    const variant = parseJsonSafe<Record<string, string | undefined>>(row.variant, {})
    return { recent, favorite, variant }
  } catch {
    return EMPTY_STATE
  }
}

export async function addRecentOpenCodeModel(
  pb: PocketBase,
  model: ModelSelectionRecord,
  userId = 'default',
): Promise<OpenCodeModelStateRecord> {
  await ensureRecordExists(pb, userId)
  const current = await getOpenCodeModelState(pb, userId)
  const deduped = [model, ...current.recent.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID)]
  const sliced = deduped.slice(0, MAX_RECENT_MODELS)
  const now = Date.now()

  const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
  await pb.collection('opencode_model_state').update(record.id, {
    recent: JSON.stringify(sliced),
    updated_at: now,
  })

  return { recent: sliced, favorite: current.favorite, variant: current.variant }
}

export async function removeRecentOpenCodeModel(
  pb: PocketBase,
  model: ModelSelectionRecord,
  userId = 'default',
): Promise<OpenCodeModelStateRecord> {
  const current = await getOpenCodeModelState(pb, userId)
  const updated = current.recent.filter(
    m => m.providerID !== model.providerID || m.modelID !== model.modelID,
  )
  const now = Date.now()

  try {
    const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
    await pb.collection('opencode_model_state').update(record.id, {
      recent: JSON.stringify(updated),
      updated_at: now,
    })
  } catch {
    // ignore if not found
  }

  return { recent: updated, favorite: current.favorite, variant: current.variant }
}

export async function toggleFavoriteOpenCodeModel(
  pb: PocketBase,
  model: ModelSelectionRecord,
  userId = 'default',
): Promise<OpenCodeModelStateRecord> {
  await ensureRecordExists(pb, userId)
  const current = await getOpenCodeModelState(pb, userId)
  const exists = current.favorite.some(
    m => m.providerID === model.providerID && m.modelID === model.modelID,
  )
  const updated = exists
    ? current.favorite.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID)
    : [...current.favorite, model]
  const now = Date.now()

  const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
  await pb.collection('opencode_model_state').update(record.id, {
    favorite: JSON.stringify(updated),
    updated_at: now,
  })

  return { recent: current.recent, favorite: updated, variant: current.variant }
}

export async function setOpenCodeVariant(
  pb: PocketBase,
  key: string,
  variant: string | undefined,
  userId = 'default',
): Promise<OpenCodeModelStateRecord> {
  await ensureRecordExists(pb, userId)
  const current = await getOpenCodeModelState(pb, userId)
  const updatedVariants = { ...current.variant }
  if (variant === undefined) {
    delete updatedVariants[key]
  } else {
    updatedVariants[key] = variant
  }
  const now = Date.now()

  const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
  await pb.collection('opencode_model_state').update(record.id, {
    variant: JSON.stringify(updatedVariants),
    updated_at: now,
  })

  return { recent: current.recent, favorite: current.favorite, variant: updatedVariants }
}
