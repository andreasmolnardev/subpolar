import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent'
import { getAuthPath, getPiModelsPath } from '@subpolar/shared/config/env'
import { readJsonSafe } from '../../utils/atomic-json'

type PiModel = {
  provider: string
  id: string
  name?: string
  api?: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  input: string[]
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
}

type PiModelsConfig = {
  providers?: Record<string, {
    name?: string
  }>
}

export type PiProviderResponse = {
  all: Array<{
    id: string
    source: 'custom' | 'builtin'
    name: string
    env: string[]
    options: Record<string, unknown>
    models: Record<string, {
      id: string
      providerID: string
      name: string
      api: {
        id: string
        npm: string
      }
      status: 'active'
      headers: Record<string, string>
      options: Record<string, unknown>
      cost: {
        input: number
        output: number
        cache: {
          read: number
          write: number
        }
      }
      limit: {
        context: number
        output: number
      }
      capabilities: {
        temperature: boolean
        reasoning: boolean
        attachment: boolean
        toolcall: boolean
        input: {
          text: boolean
          audio: boolean
          image: boolean
          video: boolean
          pdf: boolean
        }
        output: {
          text: boolean
          audio: boolean
          image: boolean
          video: boolean
          pdf: boolean
        }
      }
    }>
  }>
  connected: string[]
  default: Record<string, string>
}

function toPiModel(value: unknown): PiModel | null {
  if (!value || typeof value !== 'object') return null

  const model = value as Record<string, unknown>
  const provider = typeof model.provider === 'string' ? model.provider : null
  const id = typeof model.id === 'string' ? model.id : null
  if (!provider || !id) return null

  return {
    provider,
    id,
    name: typeof model.name === 'string' ? model.name : undefined,
    api: typeof model.api === 'string' ? model.api : undefined,
    contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : 0,
    maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : 0,
    reasoning: model.reasoning === true,
    input: Array.isArray(model.input) ? model.input.filter((item): item is string => typeof item === 'string') : ['text'],
    cost: model.cost && typeof model.cost === 'object' ? model.cost as PiModel['cost'] : undefined,
  }
}

function createPiProviderRegistry(): ReturnType<typeof ModelRegistry.create> {
  const authStorage = AuthStorage.create(getAuthPath())
  return ModelRegistry.create(authStorage, getPiModelsPath())
}

function listPiModels(modelRegistry: ReturnType<typeof ModelRegistry.create>): PiModel[] {
  return modelRegistry.getAll().flatMap((model: unknown) => {
    const parsed = toPiModel(model)
    return parsed ? [parsed] : []
  })
}

async function readCustomProviderNames(): Promise<Map<string, string>> {
  const config = await readJsonSafe<PiModelsConfig>(getPiModelsPath(), { providers: {} })
  const names = new Map<string, string>()
  for (const [providerId, provider] of Object.entries(config.providers ?? {})) {
    names.set(providerId, provider.name ?? providerId)
  }
  return names
}

export async function getPiProviders(): Promise<PiProviderResponse> {
  const modelRegistry = createPiProviderRegistry()
  const models = listPiModels(modelRegistry)
  const customProviderNames = await readCustomProviderNames()
  const providers = new Map<string, PiProviderResponse['all'][number]>()

  for (const model of models) {
    const provider = providers.get(model.provider) ?? {
      id: model.provider,
      source: customProviderNames.has(model.provider) ? 'custom' as const : 'builtin' as const,
      name: customProviderNames.get(model.provider) ?? modelRegistry.getProviderDisplayName(model.provider),
      env: [],
      options: {},
      models: {},
    }

    provider.models[model.id] = {
      id: model.id,
      providerID: model.provider,
      name: model.name ?? model.id,
      api: {
        id: model.api ?? model.id,
        npm: 'pi',
      },
      status: 'active',
      headers: {},
      options: {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cacheRead ?? 0,
          write: model.cost?.cacheWrite ?? 0,
        },
      },
      limit: {
        context: model.contextWindow,
        output: model.maxTokens,
      },
      capabilities: {
        temperature: false,
        reasoning: model.reasoning,
        attachment: model.input.includes('image'),
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: model.input.includes('image'),
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    }

    providers.set(model.provider, provider)
  }

  const connected = Array.from(providers.keys()).filter((providerId) => (
    modelRegistry.getProviderAuthStatus(providerId).configured
  ))

  return {
    all: Array.from(providers.values()),
    connected,
    default: {},
  }
}
