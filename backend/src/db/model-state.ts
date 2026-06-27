import type PocketBase from 'pocketbase'

export interface ModelSelectionRecord {
  providerID: string
  modelID: string
}

export interface PiInternalModelStateRecord {
  recent: ModelSelectionRecord[]
  favorite: ModelSelectionRecord[]
  variant: Record<string, string | undefined>
}

export const MAX_RECENT_MODELS = 10

const EMPTY_STATE: PiInternalModelStateRecord = { recent: [], favorite: [], variant: {} }

interface ModelStateRecord {
  id: string
  user_id: string
  recent: unknown
  favorite: unknown
  variant: unknown
  updated_at: number
}

async function ensureRecordExists(pb: PocketBase, userId: string): Promise<void> {
  try {
    await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
  } catch {
    await pb.collection('opencode_model_state').create({
      user_id: userId,
      recent: [],
      favorite: [],
      variant: {},
      updated_at: Date.now(),
    })
  }
}

function jsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  return value as T
}

export async function getPiInternalModelState(pb: PocketBase, userId = 'default'): Promise<PiInternalModelStateRecord> {
  try {
    const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
    const row = record as unknown as ModelStateRecord
    const recent = jsonField<ModelSelectionRecord[]>(row.recent, [])
    const favorite = jsonField<ModelSelectionRecord[]>(row.favorite, [])
    const variant = jsonField<Record<string, string | undefined>>(row.variant, {})
    return { recent, favorite, variant }
  } catch {
    return EMPTY_STATE
  }
}

export async function addRecentPiInternalModel(
  pb: PocketBase,
  model: ModelSelectionRecord,
  userId = 'default',
): Promise<PiInternalModelStateRecord> {
  await ensureRecordExists(pb, userId)
  const current = await getPiInternalModelState(pb, userId)
  const deduped = [model, ...current.recent.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID)]
  const sliced = deduped.slice(0, MAX_RECENT_MODELS)
  const now = Date.now()

  const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
  await pb.collection('opencode_model_state').update(record.id, {
    recent: sliced,
    updated_at: now,
  })

  return { recent: sliced, favorite: current.favorite, variant: current.variant }
}

export async function removeRecentPiInternalModel(
  pb: PocketBase,
  model: ModelSelectionRecord,
  userId = 'default',
): Promise<PiInternalModelStateRecord> {
  const current = await getPiInternalModelState(pb, userId)
  const updated = current.recent.filter(
    m => m.providerID !== model.providerID || m.modelID !== model.modelID,
  )
  const now = Date.now()

  try {
    const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
    await pb.collection('opencode_model_state').update(record.id, {
      recent: updated,
      updated_at: now,
    })
  } catch {
    // ignore if not found
  }

  return { recent: updated, favorite: current.favorite, variant: current.variant }
}

export async function toggleFavoritePiInternalModel(
  pb: PocketBase,
  model: ModelSelectionRecord,
  userId = 'default',
): Promise<PiInternalModelStateRecord> {
  await ensureRecordExists(pb, userId)
  const current = await getPiInternalModelState(pb, userId)
  const exists = current.favorite.some(
    m => m.providerID === model.providerID && m.modelID === model.modelID,
  )
  const updated = exists
    ? current.favorite.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID)
    : [...current.favorite, model]
  const now = Date.now()

  const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
  await pb.collection('opencode_model_state').update(record.id, {
    favorite: updated,
    updated_at: now,
  })

  return { recent: current.recent, favorite: updated, variant: current.variant }
}

export async function setPiInternalVariant(
  pb: PocketBase,
  key: string,
  variant: string | undefined,
  userId = 'default',
): Promise<PiInternalModelStateRecord> {
  await ensureRecordExists(pb, userId)
  const current = await getPiInternalModelState(pb, userId)
  const updatedVariants = { ...current.variant }
  if (variant === undefined) {
    delete updatedVariants[key]
  } else {
    updatedVariants[key] = variant
  }
  const now = Date.now()

  const record = await pb.collection('opencode_model_state').getFirstListItem(`user_id = "${userId}"`)
  await pb.collection('opencode_model_state').update(record.id, {
    variant: updatedVariants,
    updated_at: now,
  })

  return { recent: current.recent, favorite: current.favorite, variant: updatedVariants }
}
