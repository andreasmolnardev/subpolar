import type PocketBase from 'pocketbase'
import {
  PromptTemplateSchema,
  type PromptTemplate,
  type CreatePromptTemplateRequest,
  type UpdatePromptTemplateRequest,
} from '@subpolar/shared/schemas'

interface PromptTemplateRecord {
  id: string
  title: string
  category: string
  cadence_hint: string
  suggested_name: string
  suggested_description: string
  description: string
  prompt: string
  created_at: number
  updated_at: number
}

function rowToPromptTemplate(row: PromptTemplateRecord): PromptTemplate {
  return PromptTemplateSchema.parse({
    id: parseInt(row.id, 10),
    title: row.title,
    category: row.category,
    cadenceHint: row.cadence_hint,
    suggestedName: row.suggested_name,
    suggestedDescription: row.suggested_description,
    description: row.description,
    prompt: row.prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

export async function listPromptTemplates(pb: PocketBase): Promise<PromptTemplate[]> {
  const result = await pb.collection('prompt_templates').getFullList({ sort: 'id' })
  return (result as unknown as PromptTemplateRecord[]).map(rowToPromptTemplate)
}

export async function getPromptTemplateById(pb: PocketBase, id: number): Promise<PromptTemplate | null> {
  try {
    const record = await pb.collection('prompt_templates').getOne(String(id))
    return rowToPromptTemplate(record as unknown as PromptTemplateRecord)
  } catch {
    return null
  }
}

export async function createPromptTemplate(pb: PocketBase, data: CreatePromptTemplateRequest): Promise<PromptTemplate> {
  const now = Date.now()
  const record = await pb.collection('prompt_templates').create({
    title: data.title,
    category: data.category,
    cadence_hint: data.cadenceHint,
    suggested_name: data.suggestedName,
    suggested_description: data.suggestedDescription,
    description: data.description,
    prompt: data.prompt,
    created_at: now,
    updated_at: now,
  })
  return rowToPromptTemplate(record as unknown as PromptTemplateRecord)
}

export async function updatePromptTemplate(pb: PocketBase, id: number, data: UpdatePromptTemplateRequest): Promise<PromptTemplate | null> {
  const existing = await getPromptTemplateById(pb, id)
  if (!existing) return null
  const now = Date.now()
  const record = await pb.collection('prompt_templates').update(String(id), {
    title: data.title ?? existing.title,
    category: data.category ?? existing.category,
    cadence_hint: data.cadenceHint ?? existing.cadenceHint,
    suggested_name: data.suggestedName ?? existing.suggestedName,
    suggested_description: data.suggestedDescription ?? existing.suggestedDescription,
    description: data.description ?? existing.description,
    prompt: data.prompt ?? existing.prompt,
    updated_at: now,
  })
  return rowToPromptTemplate(record as unknown as PromptTemplateRecord)
}

export async function deletePromptTemplate(pb: PocketBase, id: number): Promise<boolean> {
  try {
    await pb.collection('prompt_templates').delete(String(id))
    return true
  } catch {
    return false
  }
}
