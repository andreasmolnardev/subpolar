import type { RuntimeAdapter, RuntimeEvent } from './types'

export class PiRuntimeAdapter implements RuntimeAdapter {
  id = 'pi' as const

  async *run(): AsyncIterable<RuntimeEvent> {
    yield { type: 'run.failed', error: 'Pi runtime adapter is registered but no Pi engine bridge is configured yet' }
  }

  async cancel(): Promise<void> {}
}
