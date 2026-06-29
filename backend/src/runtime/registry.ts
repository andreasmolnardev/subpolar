import type { RuntimeAdapter, RuntimeId } from './types'
import type { Database } from '../db/schema'
import type { SettingsService } from '../services/settings'
import { PiRuntimeAdapter } from './pi-runtime'
import { getOrCreateInternalToken } from '../services/internal-token'
import { ENV } from '@subpolar/shared/config/env'

export class RuntimeRegistry {
  private readonly adapters = new Map<RuntimeId, RuntimeAdapter>()

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  get(id: RuntimeId): RuntimeAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error(`Runtime adapter is not registered: ${id}`)
    return adapter
  }

  list(): RuntimeId[] {
    return Array.from(this.adapters.keys())
  }
}

export async function createRuntimeRegistry(deps: { db: Database; settingsService: SettingsService }): Promise<RuntimeRegistry> {
  void deps.settingsService
  const registry = new RuntimeRegistry()
  const internalToken = await getOrCreateInternalToken(deps.db)
  registry.register(new PiRuntimeAdapter({
    baseUrl: `http://localhost:${ENV.SERVER.PORT}`,
    internalToken,
  }))
  return registry
}
