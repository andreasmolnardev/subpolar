import { AuthStorage, type AuthCredential } from '@earendil-works/pi-coding-agent'
import { readFile } from 'node:fs/promises'
import { getAuthPath } from '@subpolar/shared/config/env'
import { logger } from '../utils/logger'
import { AuthCredentialsSchema } from '../../../shared/src/schemas/auth'
import type { z } from 'zod'
import type { Database } from '../db/schema'

type AuthCredentials = z.infer<typeof AuthCredentialsSchema>

type ProviderLoginRecord = {
  id: string
  provider_id: string
  credential: unknown
}

export class AuthService {
  constructor(private readonly db: Database) {}

  async getAll(): Promise<AuthCredentials> {
    const records = await this.db.collection('provider_logins').getFullList<ProviderLoginRecord>()
    const credentials = Object.fromEntries(records.flatMap((record) => {
      const parsed = AuthCredentialsSchema.safeParse({ [record.provider_id]: record.credential })
      return parsed.success ? Object.entries(parsed.data) : []
    }))
    return AuthCredentialsSchema.parse(credentials)
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    const existing = await this.find(providerId)
    const data = { provider_id: providerId, credential: { type: 'api_key', key: apiKey }, updated_at: Date.now() }
    if (existing) await this.db.collection('provider_logins').update(existing.id, data)
    else await this.db.collection('provider_logins').create({ ...data, created_at: Date.now() })
    logger.info(`Set credentials for provider: ${providerId}`)
  }

  async delete(providerId: string): Promise<void> {
    const existing = await this.find(providerId)
    if (existing) await this.db.collection('provider_logins').delete(existing.id)
    logger.info(`Deleted credentials for provider: ${providerId}`)
  }

  async list(): Promise<string[]> {
    const auth = await this.getAll()
    return Object.keys(auth)
  }

  async has(providerId: string): Promise<boolean> {
    return !!await this.find(providerId)
  }

  async createStorage(): Promise<AuthStorage> {
    const credentials = await this.getAll()
    const entries: Record<string, AuthCredential> = {}
    for (const [providerId, credential] of Object.entries(credentials)) {
      if (credential.type === 'api_key' && credential.key) {
        entries[providerId] = { type: 'api_key', key: credential.key }
      }
    }
    return AuthStorage.inMemory(entries)
  }

  async migrateLegacyAuthFile(): Promise<number> {
    if ((await this.list()).length > 0) return 0

    try {
      const content = await readFile(getAuthPath(), 'utf8')
      const entries = JSON.parse(content) as Record<string, unknown>
      const credentials = Object.fromEntries(Object.entries(entries).flatMap(([providerId, credential]) => {
        if (!credential || typeof credential !== 'object') return []
        const entry = credential as Record<string, unknown>
        if (entry.type === 'apiKey' && typeof entry.apiKey === 'string') {
          return [[providerId, { type: 'api_key', key: entry.apiKey }]]
        }
        if (entry.type === 'api' && typeof entry.key === 'string') {
          return [[providerId, { type: 'api_key', key: entry.key }]]
        }
        return [[providerId, entry]]
      }))
      const parsed = AuthCredentialsSchema.safeParse(credentials)
      if (!parsed.success) return 0

      await Promise.all(Object.entries(parsed.data).flatMap(([providerId, credential]) => (
        credential.type === 'api_key' && credential.key ? [this.set(providerId, credential.key)] : []
      )))
      const count = Object.keys(parsed.data).length
      if (count > 0) logger.info(`Migrated ${count} provider login${count === 1 ? '' : 's'} to the database`)
      return count
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Unable to migrate legacy provider credentials:', error)
      }
      return 0
    }
  }

  private async find(providerId: string): Promise<ProviderLoginRecord | null> {
    const records = await this.db.collection('provider_logins').getFullList<ProviderLoginRecord>()
    return records.find((record) => record.provider_id === providerId) ?? null
  }
}
