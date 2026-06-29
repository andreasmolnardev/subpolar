import { getPiModelsPath } from '@subpolar/shared/config/env'
import { z } from 'zod'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../utils/atomic-json'

const ApiTypeSchema = z.enum([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
  'azure-openai-responses',
  'openai-codex-responses',
  'mistral-conversations',
  'google-generative-ai',
  'google-vertex',
  'bedrock-converse-stream',
])

const CustomModelSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  api: ApiTypeSchema.optional(),
  baseUrl: z.string().trim().min(1).optional(),
  reasoning: z.boolean().default(false),
  input: z.array(z.enum(['text', 'image'])).min(1).default(['text']),
  cost: z.object({
    input: z.number().nonnegative().default(0),
    output: z.number().nonnegative().default(0),
    cacheRead: z.number().nonnegative().default(0),
    cacheWrite: z.number().nonnegative().default(0),
  }).default({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
  contextWindow: z.number().int().positive().default(128000),
  maxTokens: z.number().int().positive().default(16384),
  headers: z.record(z.string(), z.string()).optional(),
})

export const CustomProviderSchema = z.object({
  id: z.string().trim().min(1).regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().trim().min(1),
  baseUrl: z.string().trim().min(1),
  api: ApiTypeSchema,
  apiKey: z.string().trim().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  authHeader: z.boolean().default(false),
  models: z.array(CustomModelSchema).min(1),
  modelOverrides: z.record(z.string(), z.unknown()).optional(),
})

export type CustomProvider = z.infer<typeof CustomProviderSchema>

type PiModelsConfig = {
  providers: Record<string, Omit<CustomProvider, 'id'>>
}

function emptyModelsConfig(): PiModelsConfig {
  return { providers: {} }
}

function stripProviderId(provider: CustomProvider): Omit<CustomProvider, 'id'> {
  const { id, ...config } = provider
  void id
  return config
}

function attachProviderId(id: string, provider: Omit<CustomProvider, 'id'>): CustomProvider {
  return CustomProviderSchema.parse({ id, ...provider })
}

async function readModelsConfig(): Promise<PiModelsConfig> {
  const config = await readJsonSafe<PiModelsConfig>(getPiModelsPath(), emptyModelsConfig())
  return {
    providers: config.providers && typeof config.providers === 'object' ? config.providers : {},
  }
}

export class PiCustomProviderService {
  async list(): Promise<CustomProvider[]> {
    const config = await readModelsConfig()
    return Object.entries(config.providers).flatMap(([id, provider]) => {
      const parsed = CustomProviderSchema.safeParse({ id, ...provider })
      return parsed.success ? [parsed.data] : []
    })
  }

  async upsert(input: unknown): Promise<CustomProvider> {
    const provider = CustomProviderSchema.parse(input)
    const modelsPath = getPiModelsPath()
    await withFileLock(modelsPath, async () => {
      const config = await readModelsConfig()
      config.providers[provider.id] = stripProviderId(provider)
      await writeJsonAtomic(modelsPath, config)
    })
    return provider
  }

  async delete(id: string): Promise<boolean> {
    const providerId = z.string().trim().min(1).parse(id)
    const modelsPath = getPiModelsPath()
    let existed = false
    await withFileLock(modelsPath, async () => {
      const config = await readModelsConfig()
      existed = Object.hasOwn(config.providers, providerId)
      delete config.providers[providerId]
      await writeJsonAtomic(modelsPath, config)
    })
    return existed
  }

  async get(id: string): Promise<CustomProvider | null> {
    const config = await readModelsConfig()
    const provider = config.providers[id]
    return provider ? attachProviderId(id, provider) : null
  }
}
