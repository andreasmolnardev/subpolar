import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent'

type PiModel = {
  provider: string
  id: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  input: string[]
}

export type PiProviderResponse = {
  all: Array<{
    id: string
    source: 'builtin'
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
    contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : 0,
    maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : 0,
    reasoning: model.reasoning === true,
    input: Array.isArray(model.input) ? model.input.filter((item): item is string => typeof item === 'string') : ['text'],
  }
}

async function listPiModels(): Promise<PiModel[]> {
  const authStorage = AuthStorage.create()
  const modelRegistry = ModelRegistry.create(authStorage)
  const models = await modelRegistry.getAvailable()
  return models.flatMap((model) => {
    const parsed = toPiModel(model)
    return parsed ? [parsed] : []
  })
}

export async function getPiProviders(): Promise<PiProviderResponse> {
  const models = await listPiModels()
  const providers = new Map<string, PiProviderResponse['all'][number]>()

  for (const model of models) {
    const provider = providers.get(model.provider) ?? {
      id: model.provider,
      source: 'builtin' as const,
      name: model.provider,
      env: [],
      options: {},
      models: {},
    }

    provider.models[model.id] = {
      id: model.id,
      providerID: model.provider,
      name: model.id,
      api: {
        id: model.id,
        npm: 'pi',
      },
      status: 'active',
      headers: {},
      options: {},
      cost: {
        input: 0,
        output: 0,
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

  return {
    all: Array.from(providers.values()),
    connected: Array.from(providers.keys()),
    default: {},
  }
}
