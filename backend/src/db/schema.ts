import { getPocketBaseClient, closePocketBaseClient } from './pocketbase-client'
import type PocketBase from 'pocketbase'
import { logger } from '../utils/logger'
import { ENV } from '@subpolar/shared/config/env'
import { DEFAULT_USER_PREFERENCES } from '@subpolar/shared/schemas'

export type Database = PocketBase

export async function initializeDatabase(): Promise<Database> {
  if (!ENV.POCKETBASE?.URL || ENV.POCKETBASE.URL === '') {
    throw new Error('POCKETBASE_URL is not configured. PocketBase is required.')
  }

  try {
    const pb = await getPocketBaseClient()

    const existing = await pb.collection('user_preferences').getFirstListItem('user_id = "default"').catch(() => null)
    if (!existing) {
      await pb.collection('user_preferences').create({
        user_id: 'default',
        preferences: DEFAULT_USER_PREFERENCES,
        updated_at: Date.now(),
      })
      logger.info('Created default user preferences')
    }

    logger.info('PocketBase database initialized successfully')
    return pb
  } catch (error) {
    logger.error('Failed to initialize PocketBase:', error)
    throw error
  }
}

export { getPocketBaseClient, closePocketBaseClient }
